"""Agent chat route — POST /api/agent/chat.

Streams SSE events from a Gemini-powered agent that can call iris editing
tools (analyze, identify, generate, accept, export, etc.) via function calling.
The agent loops: text tokens stream to the client, function calls are executed
in-process, and their results are fed back to Gemini until the model finishes.
"""

import asyncio
import json
import logging
import os
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from pydantic import BaseModel
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.deps import get_runner, get_session
from app.models.conversation import Conversation, ChatMessage
from app.models.session import Session as SessionModel
from app.services.agent_tools import execute_tool
from app.services import job_events

log = logging.getLogger("iris.agent")
router = APIRouter(prefix="/agent", tags=["agent"])

# ---- request schema ----

class BBoxParam(BaseModel):
    """Normalized 0-1 bounding box the user has drawn on the preview."""

    x: float
    y: float
    w: float
    h: float


class AgentChatRequest(BaseModel):
    project_id: str
    message: str
    conversation_id: str
    history: list[dict[str, Any]] | None = None

    # Live editor context — the chat UI knows the user's current playhead,
    # timeline duration, and any bounding box they've drawn. Passing this
    # explicitly means Gemini never has to ask the user "what's the
    # project_id?" or "where is the man?" — the agent answers its own
    # questions from the editor state.
    playhead_ts: float | None = None
    duration: float | None = None
    bbox: BBoxParam | None = None


# ---- system prompt ----

SYSTEM_PROMPT = """\
You are the iris video editing agent. You help users edit videos using AI-powered tools.

Operate like an editing copilot, not just a prompt box.

Preferred workflow:
1. Understand the current reel state with get_timeline, preview_frame, and preview_strip.
2. Use analyze_video only when broader scene/entity context would genuinely help.
3. Use identify_region when the user points at a subject or bounding box.
4. Use generate_edit for localized edits, then IMMEDIATELY call wait_for_job
   with the returned job_id so the variants are in hand before you reply.
   Only use get_job_status when you need a non-blocking peek.
   When wait_for_job returns, inspect result.variants_ready: if it's 0,
   the render failed (often veo rate-limiting / quota). TELL THE USER
   EXACTLY what went wrong using result.variant_errors or result.error,
   suggest they retry in a minute, and DO NOT call accept_variant.
5. Before destructive timeline moves, use snapshot_timeline so reverts stay cheap.
6. Use score_variant, score_continuity, remix_variant, split_segment, trim_segment, delete_segment, and color_grade when they clearly improve the edit.
7. NEVER call accept_variant on your own. Acceptance is a human decision —
   the iris UI shows the rendered variants to the user with their own
   "apply" button, and only fires accept_variant when they click it. Your
   job ends at "variants ready, here's what I made, tell me which one to
   apply or ask for a remix".
8. For exports, use export_video and then get_export_status until the file is ready.

Important constraints and habits:
- Video segments for generation must be 2-5 seconds long
- Bounding boxes use normalized coordinates (0-1)
- Be explicit about when a tool is a placeholder or best-effort path
- Prefer previewing, scoring, and remixing over blind re-generation when the user is refining an edit
- Keep the user in the loop while a render is in flight (one short "generating…" line is fine; don't spam status updates)

CRITICAL — editor context:
The "Current editor context" block at the end of these instructions is ground
truth supplied by the iris frontend on every turn. It already contains the
active project_id, the user's playhead timestamp, the full reel duration,
and any bounding box the user has drawn on the preview. You MUST use those
values directly. Do NOT ask the user for a project_id, a bounding box, or
timestamps that you can derive from the playhead, duration, or their
natural-language request (e.g. "the first 3 seconds" = start_ts 0.0,
end_ts 3.0). Only ask for clarification if the request is genuinely
ambiguous in a way the context can't resolve.

CRITICAL — accept_variant is user-driven:
If the user's message is an explicit acceptance instruction (e.g. contains
phrases like "accept variant N for job <id>", "apply variant N", "use that
take", "yes, go with variant 1"), then — and only then — call
accept_variant with the matching job_id and variant_index. Otherwise, do
NOT call it, even if the user says "looks good" or "perfect"; treat those
as confirmation that you've understood the brief, not an instruction to
commit the edit.

Be concise and helpful. Describe what you're doing at each step.\
"""


def _format_bbox(bbox: Any) -> str:
    if bbox is None:
        return "none (no bounding box drawn — use full-frame edits or ask the user to draw one only if the edit truly needs a region)"
    try:
        return (
            f"x={bbox.x:.3f}, y={bbox.y:.3f}, "
            f"w={bbox.w:.3f}, h={bbox.h:.3f}  (normalized 0-1)"
        )
    except AttributeError:
        return str(bbox)


def _build_context_block(body: "AgentChatRequest") -> str:
    """Stamp the live editor context onto the system prompt.

    Gemini otherwise treats the tool declarations as a form and asks the
    user to fill it in (project_id, bbox, etc.). Giving it the values
    up front makes the agent actually use tools instead of interrogating
    the user for data the frontend already has.
    """
    playhead = (
        f"{body.playhead_ts:.3f}s" if body.playhead_ts is not None else "unknown"
    )
    duration = (
        f"{body.duration:.3f}s" if body.duration is not None else "unknown"
    )
    return (
        "\n\n## Current editor context\n"
        f"- project_id: {body.project_id}\n"
        f"- playhead_ts: {playhead}\n"
        f"- timeline_duration: {duration}\n"
        f"- active_bbox: {_format_bbox(body.bbox)}\n"
    )

# ---- Gemini tool declarations ----

TOOL_DECLARATIONS = [
    types.FunctionDeclaration(
        name="analyze_video",
        description=(
            "Analyze the video content by extracting frames and understanding "
            "scenes, objects, entities, mood, and lighting. Use this first to "
            "understand what's in the video before making edits."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "fps": types.Schema(type=types.Type.NUMBER, description="Frames per second to sample (default 1.0)"),
            },
            required=["project_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="identify_region",
        description=(
            "Identify what object/entity is inside a bounding box region of a "
            "video frame. Returns description, category, and attributes."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING),
                "frame_ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="Timestamp in seconds of the frame to analyze",
                ),
                "bbox": types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "x": types.Schema(type=types.Type.NUMBER),
                        "y": types.Schema(type=types.Type.NUMBER),
                        "w": types.Schema(type=types.Type.NUMBER),
                        "h": types.Schema(type=types.Type.NUMBER),
                    },
                    description="Normalized 0-1 bounding box",
                ),
            },
            required=["project_id", "frame_ts", "bbox"],
        ),
    ),
    types.FunctionDeclaration(
        name="generate_edit",
        description=(
            "Generate an AI-edited variant of a video segment. The segment must "
            "be 2-5 seconds long. Provide a bounding box for the region to edit "
            "and a text prompt describing the desired change."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING),
                "start_ts": types.Schema(type=types.Type.NUMBER),
                "end_ts": types.Schema(type=types.Type.NUMBER),
                "bbox": types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "x": types.Schema(type=types.Type.NUMBER),
                        "y": types.Schema(type=types.Type.NUMBER),
                        "w": types.Schema(type=types.Type.NUMBER),
                        "h": types.Schema(type=types.Type.NUMBER),
                    },
                ),
                "prompt": types.Schema(type=types.Type.STRING, description="What change to make"),
                "reference_frame_ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="Frame timestamp for reference (defaults to start_ts)",
                ),
            },
            required=["project_id", "start_ts", "end_ts", "bbox", "prompt"],
        ),
    ),
    types.FunctionDeclaration(
        name="get_job_status",
        description="Check the status of a generation, entity, or other non-export job and get any variant results.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "job_id": types.Schema(type=types.Type.STRING),
            },
            required=["job_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="wait_for_job",
        description=(
            "Block until a generation job finishes (status=done) or a "
            "timeout elapses. Call this RIGHT AFTER generate_edit so the "
            "variants are in hand before you reply to the user. Returns "
            "the same shape as get_job_status plus a 'waited_s' field."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "job_id": types.Schema(type=types.Type.STRING),
                "timeout_s": types.Schema(
                    type=types.Type.NUMBER,
                    description="Max seconds to wait (default 180).",
                ),
            },
            required=["job_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="accept_variant",
        description="Accept a generated variant, applying it to the timeline.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "job_id": types.Schema(type=types.Type.STRING),
                "variant_index": types.Schema(
                    type=types.Type.INTEGER,
                    description="Which variant to accept (default 0)",
                ),
            },
            required=["job_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="get_timeline",
        description="Get the current timeline showing all segments (original and edited).",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING),
            },
            required=["project_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="export_video",
        description="Export the final edited video as MP4.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING),
            },
            required=["project_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="get_export_status",
        description="Check the status of an export job and retrieve the output URLs when it is done.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "export_job_id": types.Schema(type=types.Type.STRING),
            },
            required=["export_job_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="preview_frame",
        description="Get a preview frame for a project timeline at a specific timestamp.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="Timestamp in seconds",
                ),
            },
            required=["project_id", "ts"],
        ),
    ),
    types.FunctionDeclaration(
        name="preview_strip",
        description="Get a thumbnail strip for scrubbing across a timeline range.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "start": types.Schema(
                    type=types.Type.NUMBER,
                    description="Start timestamp in seconds",
                ),
                "end": types.Schema(
                    type=types.Type.NUMBER,
                    description="End timestamp in seconds",
                ),
                "fps": types.Schema(
                    type=types.Type.NUMBER,
                    description="Frames per second to sample (default 1.0)",
                ),
            },
            required=["project_id", "start", "end"],
        ),
    ),
    types.FunctionDeclaration(
        name="split_segment",
        description="Split a timeline segment at a timestamp.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "segment_id": types.Schema(type=types.Type.STRING, description="The segment ID"),
                "split_ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="Timestamp in seconds to split at",
                ),
            },
            required=["project_id", "segment_id", "split_ts"],
        ),
    ),
    types.FunctionDeclaration(
        name="trim_segment",
        description="Trim a segment to new start and end boundaries.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "segment_id": types.Schema(type=types.Type.STRING, description="The segment ID"),
                "new_start_ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="New segment start timestamp in seconds",
                ),
                "new_end_ts": types.Schema(
                    type=types.Type.NUMBER,
                    description="New segment end timestamp in seconds",
                ),
            },
            required=["project_id", "segment_id", "new_start_ts", "new_end_ts"],
        ),
    ),
    types.FunctionDeclaration(
        name="delete_segment",
        description="Soft delete a timeline segment by marking it inactive.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "segment_id": types.Schema(type=types.Type.STRING, description="The segment ID"),
            },
            required=["project_id", "segment_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="color_grade",
        description="Apply color grading adjustments to a segment.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "segment_id": types.Schema(type=types.Type.STRING, description="The segment ID"),
                "brightness": types.Schema(type=types.Type.NUMBER, description="Brightness adjustment"),
                "contrast": types.Schema(type=types.Type.NUMBER, description="Contrast adjustment"),
                "saturation": types.Schema(type=types.Type.NUMBER, description="Saturation adjustment"),
                "temperature": types.Schema(type=types.Type.NUMBER, description="Color temperature adjustment"),
                "gamma": types.Schema(type=types.Type.NUMBER, description="Gamma adjustment"),
                "hue_shift": types.Schema(type=types.Type.NUMBER, description="Hue shift adjustment"),
            },
            required=["segment_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="grade_preview",
        description="Preview color grading adjustments on a single frame of a segment.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "segment_id": types.Schema(type=types.Type.STRING, description="The segment ID"),
                "brightness": types.Schema(type=types.Type.NUMBER, description="Brightness adjustment"),
                "contrast": types.Schema(type=types.Type.NUMBER, description="Contrast adjustment"),
                "saturation": types.Schema(type=types.Type.NUMBER, description="Saturation adjustment"),
                "temperature": types.Schema(type=types.Type.NUMBER, description="Color temperature adjustment"),
                "gamma": types.Schema(type=types.Type.NUMBER, description="Gamma adjustment"),
                "hue_shift": types.Schema(type=types.Type.NUMBER, description="Hue shift adjustment"),
            },
            required=["segment_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="score_variant",
        description="Get detailed quality scoring for a generated variant.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "variant_id": types.Schema(type=types.Type.STRING, description="The variant ID"),
                "compare_to": types.Schema(
                    type=types.Type.STRING,
                    description="Comparison target: prompt or original (default prompt)",
                ),
            },
            required=["variant_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="score_continuity",
        description="Check temporal consistency across the current timeline.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
            },
            required=["project_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="remix_variant",
        description="Create a refined remix job from an existing variant.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "variant_id": types.Schema(type=types.Type.STRING, description="The source variant ID"),
                "modifier_prompt": types.Schema(
                    type=types.Type.STRING,
                    description="How to refine the existing variant",
                ),
                "preserve_composition": types.Schema(
                    type=types.Type.BOOLEAN,
                    description="Whether to preserve the original composition (default true)",
                ),
            },
            required=["variant_id", "modifier_prompt"],
        ),
    ),
    types.FunctionDeclaration(
        name="batch_generate",
        description="Submit multiple generation jobs in a single batch.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "edits": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                            "start_ts": types.Schema(type=types.Type.NUMBER, description="Segment start timestamp in seconds"),
                            "end_ts": types.Schema(type=types.Type.NUMBER, description="Segment end timestamp in seconds"),
                            "bbox": types.Schema(
                                type=types.Type.OBJECT,
                                properties={
                                    "x": types.Schema(type=types.Type.NUMBER),
                                    "y": types.Schema(type=types.Type.NUMBER),
                                    "w": types.Schema(type=types.Type.NUMBER),
                                    "h": types.Schema(type=types.Type.NUMBER),
                                },
                            ),
                            "prompt": types.Schema(type=types.Type.STRING, description="What change to make"),
                        },
                        required=["project_id", "start_ts", "end_ts", "bbox", "prompt"],
                    ),
                    description="Batch edit requests to submit",
                ),
            },
            required=["edits"],
        ),
    ),
    types.FunctionDeclaration(
        name="snapshot_timeline",
        description="Save a checkpoint of the current project timeline.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
            },
            required=["project_id"],
        ),
    ),
    types.FunctionDeclaration(
        name="revert_timeline",
        description="Revert a project timeline to a saved checkpoint.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "project_id": types.Schema(type=types.Type.STRING, description="The project ID"),
                "snapshot_id": types.Schema(type=types.Type.STRING, description="The snapshot ID"),
            },
            required=["project_id", "snapshot_id"],
        ),
    ),
]

TOOLS = [types.Tool(function_declarations=TOOL_DECLARATIONS)]

# ---- SSE helpers ----


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a single SSE event.

    Also logs every emission so we can reconstruct exactly what the
    browser saw when debugging chat flow bugs. We shorten obviously
    huge fields (variant url lists, tool results) to keep the log
    readable while still recording the event shape.
    """
    # Compact summary of the payload for the log line.
    summary_bits: list[str] = []
    for key in ("id", "tool", "status", "job_id", "edit"):
        if key in data:
            v = data[key]
            if isinstance(v, dict):
                summary_bits.append(f"{key}={{…}}")
            else:
                summary_bits.append(f"{key}={v}")
    if "variants" in data and isinstance(data["variants"], list):
        summary_bits.append(f"variants={len(data['variants'])}")
    if "result" in data and isinstance(data["result"], dict):
        keys = ",".join(sorted(data["result"].keys()))
        summary_bits.append(f"result_keys={keys}")
    if "text" in data and isinstance(data["text"], str):
        summary_bits.append(f"text_len={len(data['text'])}")
    if "error" in data:
        summary_bits.append(f"error={str(data['error'])[:80]}")
    log.info("[sse emit] event=%s %s", event, " ".join(summary_bits))
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _bridge_plan_events(
    job_id: str,
    timeout_s: float = 25.0,
) -> AsyncGenerator[str, None]:
    """Forward the prompt-rewrite layer's events onto the chat stream.

    The ``generate_job`` worker publishes a rich trail of stage events on
    the per-job event bus (plan_start, plan_done, veo_start, variant_done…).
    The Pro-mode reveal panel consumes these directly via
    ``/api/jobs/{id}/stream``, but the Vibe-mode agent chat only hears the
    agent SSE stream — so by default the user never sees that Gemini is
    quietly rewriting their one-line prompt into a 60-word Veo brief.

    This helper bridges the gap for exactly the events that are interesting
    in chat form:
      • ``plan_start``  → a "rewriting prompt…" marker
      • ``plan_done``   → a card with the full rewritten Veo prompt,
                          intent, conditioning strategy, and tone
      • ``veo_start``   → a "dispatching to veo" follow-up

    We stop early once we've seen plan_done (the most interesting event)
    OR a terminal event, and we always stop after ``timeout_s`` regardless,
    so the agent loop can't block the chat stream on a stuck plan.
    """
    log.info("[agent.chat] plan bridge START job=%s timeout=%.1fs", job_id, timeout_s)
    seen_plan_done = False
    try:
        # Race the event subscription against a hard timeout so a stuck
        # plan can't hang the chat stream. ``async for`` on the job bus
        # iterator will yield replayed history first, then live events.
        async def _consume() -> AsyncGenerator[str, None]:
            nonlocal seen_plan_done
            async for ev in job_events.subscribe(job_id):
                stage = ev.get("stage", "")
                data = ev.get("data") or {}
                if stage == "plan_start":
                    yield sse_event("prompt_plan_started", {
                        "job_id": job_id,
                        "user_prompt": data.get("user_prompt", ""),
                    })
                elif stage == "plan_done":
                    plan = data.get("plan") or {}
                    yield sse_event("prompt_plan", {
                        "job_id": job_id,
                        "plan": {
                            "description": plan.get("description"),
                            "intent": plan.get("intent"),
                            "conditioning_strategy": plan.get("conditioning_strategy"),
                            "tone": plan.get("tone"),
                            "color_grading": plan.get("color_grading"),
                            "region_emphasis": plan.get("region_emphasis"),
                            "prompt_for_veo": plan.get("prompt_for_veo"),
                        },
                    })
                    seen_plan_done = True
                elif stage == "veo_start":
                    yield sse_event("veo_dispatch", {
                        "job_id": job_id,
                        "strategy": data.get("strategy"),
                        "conditioned_on": data.get("conditioned_on"),
                    })
                    # plan is in the bag and Veo is spinning up; that's
                    # the most informative "we're now rendering" signal
                    # we can give the user while wait_for_job blocks.
                    return
                if ev.get("terminal"):
                    return
                if seen_plan_done and stage not in ("plan_done",):
                    # we already gave the user the important card; bail
                    # so the next agent turn can take over quickly.
                    return

        timed = _timed_iter(_consume(), timeout_s)
        async for out in timed:
            yield out
    except Exception:
        log.exception("[agent.chat] plan bridge failed for job=%s", job_id)
    log.info(
        "[agent.chat] plan bridge END job=%s plan_done=%s",
        job_id,
        seen_plan_done,
    )


async def _timed_iter(
    agen: AsyncGenerator[str, None],
    timeout_s: float,
) -> AsyncGenerator[str, None]:
    """Drain ``agen`` until it finishes or ``timeout_s`` elapses in total."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            try:
                item = await asyncio.wait_for(agen.__anext__(), timeout=remaining)
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError:
                return
            yield item
    finally:
        await agen.aclose()


def _build_contents(
    history: list[dict[str, Any]] | None,
    message: str,
) -> list[types.Content]:
    """Convert the incoming history + new message into Gemini Content objects.

    History items are expected as:
        {"role": "user"|"model", "text": "..."}
    """
    contents: list[types.Content] = []

    if history:
        for entry in history:
            role = entry.get("role", "user")
            text = entry.get("text", "")
            if role == "assistant":
                role = "model"
            elif role not in ("user", "model"):
                role = "user"
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))

    # append the new user message
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))
    return contents


# ---- streaming agent loop ----


async def _agent_stream(
    *,
    request: Request,
    body: AgentChatRequest,
    session_id: str,
    runner: Any,
) -> AsyncGenerator[str, None]:
    """Async generator that drives the Gemini agent loop and yields SSE events."""

    req_id = uuid.uuid4().hex[:8]
    log.info(
        "[agent.chat] START req=%s project=%s convo=%s msg=%r playhead=%s dur=%s bbox=%s",
        req_id,
        body.project_id,
        body.conversation_id,
        body.message[:120],
        body.playhead_ts,
        body.duration,
        _format_bbox(body.bbox),
    )

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        log.error("[agent.chat] req=%s GEMINI_API_KEY not configured", req_id)
        yield sse_event("error", {"message": "GEMINI_API_KEY is not configured"})
        yield sse_event("done", {})
        return

    # ── conversation persistence: get or create ──
    #
    # We deliberately DO NOT hold a single request-scoped DB session across
    # the whole stream. The agent loop can run 180+ seconds (wait_for_job)
    # and pinning a pool connection that long exhausts the SQLAlchemy pool
    # after ~15 concurrent chats with a "QueuePool limit of size N /
    # overflow M reached" timeout. Instead, each DB touch opens a fresh
    # short-lived session from AsyncSessionLocal.
    async with AsyncSessionLocal() as db:
        convo = (
            await db.execute(
                select(Conversation).where(Conversation.id == body.conversation_id)
            )
        ).scalar_one_or_none()

        if convo is None:
            convo = Conversation(
                id=body.conversation_id,
                project_id=body.project_id,
                session_id=session_id,
            )
            db.add(convo)
            await db.commit()
            await db.refresh(convo)

        # persist the user message
        user_msg = ChatMessage(
            conversation_id=convo.id,
            role="user",
            content={"text": body.message},
        )
        db.add(user_msg)
        await db.commit()
        convo_id = convo.id

    # collect agent text for persistence after stream completes
    _agent_text_parts: list[str] = []
    _tool_calls_log: list[dict[str, Any]] = []

    client = genai.Client(api_key=api_key)

    contents = _build_contents(body.history, body.message)

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT + _build_context_block(body),
        tools=TOOLS,
    )

    # Agentic loop: keep calling Gemini until it stops issuing function calls
    max_turns = 10  # safety cap to prevent infinite loops
    turn = 0

    while turn < max_turns:
        turn += 1
        log.info("[agent.chat] req=%s turn=%d calling gemini (contents=%d)", req_id, turn, len(contents))

        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=config,
            )
        except Exception as exc:
            log.exception("[agent.chat] req=%s Gemini API call failed on turn %d", req_id, turn)
            yield sse_event("error", {"message": f"Gemini API error: {exc}"})
            yield sse_event("done", {})
            return

        # Check if the client disconnected
        if await request.is_disconnected():
            log.info("Client disconnected during agent loop")
            return

        if not response.candidates:
            yield sse_event("error", {"message": "No response from Gemini"})
            yield sse_event("done", {})
            return

        candidate = response.candidates[0]
        parts = candidate.content.parts if candidate.content else []

        # Collect text parts and function call parts
        text_parts: list[str] = []
        function_calls: list[types.FunctionCall] = []

        for part in parts:
            if part.text:
                text_parts.append(part.text)
            if part.function_call:
                function_calls.append(part.function_call)

        # Stream accumulated text as a token event
        if text_parts:
            full_text = "".join(text_parts)
            _agent_text_parts.append(full_text)
            yield sse_event("token", {"text": full_text})

        log.info(
            "[agent.chat] req=%s turn=%d parts=%d text_chars=%d fcalls=%d → %s",
            req_id,
            turn,
            len(parts),
            sum(len(t) for t in text_parts),
            len(function_calls),
            [fc.name for fc in function_calls] or "<no calls, turn ends>",
        )

        # If no function calls, the model is done
        if not function_calls:
            break

        # Execute each function call and collect results
        function_responses: list[types.Part] = []

        for fc in function_calls:
            tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}

            _tool_calls_log.append({"id": tool_call_id, "tool": tool_name, "args": tool_args})

            log.info(
                "[agent.chat] req=%s tool_call %s tool=%s args_keys=%s",
                req_id,
                tool_call_id,
                tool_name,
                list(tool_args.keys()),
            )

            yield sse_event("tool_call_start", {
                "id": tool_call_id,
                "tool": tool_name,
                "args": tool_args,
            })

            try:
                import time as _time
                t0 = _time.monotonic()
                # Each tool call gets its own short-lived DB session — the
                # tools can take a long time (wait_for_job polls for minutes)
                # and reusing a shared session would pin a pool connection
                # for the whole stream. Tools that need to span multiple
                # sessions (e.g. wait_for_job's poll loop) already open
                # their own inside via AsyncSessionLocal.
                async with AsyncSessionLocal() as tool_db:
                    result = await execute_tool(
                        tool_name=tool_name,
                        args=tool_args,
                        db=tool_db,
                        session_id=session_id,
                        runner=runner,
                    )
                took = _time.monotonic() - t0
                result_summary: str
                if isinstance(result, dict):
                    result_summary = f"keys={sorted(result.keys())}"
                else:
                    result_summary = f"type={type(result).__name__}"
                log.info(
                    "[agent.chat] req=%s tool_result %s tool=%s took=%.2fs %s",
                    req_id,
                    tool_call_id,
                    tool_name,
                    took,
                    result_summary,
                )
                yield sse_event("tool_call_end", {
                    "id": tool_call_id,
                    "tool": tool_name,
                    "result": result,
                    "status": "done",
                })

                # Emit special events for specific tool results
                if tool_name == "generate_edit" and "job_id" in result:
                    yield sse_event("suggestion", {
                        "edit": {
                            "job_id": result["job_id"],
                            "start_ts": tool_args.get("start_ts"),
                            "end_ts": tool_args.get("end_ts"),
                            "bbox_hint": tool_args.get("bbox"),
                            "suggestion": tool_args.get("prompt", ""),
                        },
                    })
                    # Bridge the prompt-rewrite layer into chat. The worker
                    # fires ``plan_start`` → ``plan_done`` → ``veo_start``
                    # on the job event bus; we forward them so the user
                    # sees Gemini's Veo-ready rewrite of their one-line
                    # request as a card in the chat. Bounded at ~25s so
                    # a stuck plan can't hang the stream.
                    async for evt in _bridge_plan_events(result["job_id"], timeout_s=25.0):
                        yield evt

                if tool_name in ("get_job_status", "wait_for_job"):
                    job_status = result.get("status")
                    variants = result.get("variants", []) or []
                    ready = [v for v in variants if v.get("url")]
                    log.info(
                        "[agent] %s finished: status=%s variants=%d url_count=%d",
                        tool_name,
                        job_status,
                        len(variants),
                        len(ready),
                    )

                    # Terminal without usable output = surface it as a
                    # first-class failure card so the user stops
                    # staring at a "generating…" suggestion that never
                    # produces a preview. We pull the best error blurb
                    # we can find (job-level, then per-variant) so
                    # Veo 429s and plan failures are both readable.
                    is_terminal = job_status in ("done", "error", "failed", "cancelled")
                    if is_terminal and not ready:
                        raw_errors: list[str] = []
                        if result.get("error"):
                            raw_errors.append(str(result["error"]))
                        for v in variants:
                            if v.get("error"):
                                raw_errors.append(str(v["error"]))
                        err_msg = raw_errors[0] if raw_errors else "no variants produced"
                        yield sse_event("generation_failed", {
                            "job_id": result.get("job_id", ""),
                            "error": err_msg,
                        })

                    # Variant preview card — shown whenever at least one
                    # variant actually uploaded successfully. We don't gate
                    # on job.status since the worker occasionally stamps
                    # the status row after the variant file is already live.
                    if ready:
                        yield sse_event("variant_ready", {
                            "job_id": result.get("job_id", ""),
                            "variants": ready,
                        })

                function_responses.append(
                    types.Part.from_function_response(
                        name=tool_name,
                        response=result,
                    )
                )

            except Exception as exc:
                log.exception("Tool execution failed: %s", tool_name)
                error_result = {"error": str(exc)}
                yield sse_event("tool_call_end", {
                    "id": tool_call_id,
                    "tool": tool_name,
                    "result": error_result,
                    "status": "error",
                })
                function_responses.append(
                    types.Part.from_function_response(
                        name=tool_name,
                        response=error_result,
                    )
                )

        # Feed the model's response + function results back into the conversation
        contents.append(candidate.content)
        contents.append(types.Content(role="user", parts=function_responses))

    # ── persist agent response ──
    try:
        agent_content: dict[str, Any] = {}
        combined_text = "".join(_agent_text_parts)
        if combined_text:
            agent_content["text"] = combined_text
        if _tool_calls_log:
            agent_content["tool_calls"] = _tool_calls_log
        if agent_content:
            async with AsyncSessionLocal() as db:
                agent_msg = ChatMessage(
                    conversation_id=convo_id,
                    role="agent",
                    content=agent_content,
                )
                db.add(agent_msg)
                await db.commit()
    except Exception:
        log.exception("failed to persist agent response")

    yield sse_event("done", {})


# ---- route ----


@router.post("/chat")
async def agent_chat(
    body: AgentChatRequest,
    request: Request,
    session: SessionModel = Depends(get_session),
    runner=Depends(get_runner),
) -> StreamingResponse:
    """Stream an agent conversation with tool-calling over SSE.

    Note: we deliberately do NOT depend on ``get_db`` here. The SSE stream
    can take 3+ minutes while Veo renders, and a request-scoped session
    would pin a pool connection that entire time, exhausting the pool
    after ~15 chats. ``_agent_stream`` opens short-lived sessions as it
    needs them instead.
    """
    return StreamingResponse(
        _agent_stream(
            request=request,
            body=body,
            session_id=session.id,
            runner=runner,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
