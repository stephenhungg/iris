"""Agent chat route — POST /api/agent/chat.

Streams SSE events from a Gemini-powered agent that can call iris editing
tools (analyze, identify, generate, accept, export, etc.) via function calling.
The agent loops: text tokens stream to the client, function calls are executed
in-process, and their results are fed back to Gemini until the model finishes.
"""

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
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import get_runner, get_session
from app.models.session import Session as SessionModel
from app.services.agent_tools import execute_tool

log = logging.getLogger("iris.agent")
router = APIRouter(prefix="/agent", tags=["agent"])

# ---- request schema ----

class AgentChatRequest(BaseModel):
    project_id: str
    message: str
    conversation_id: str
    history: list[dict[str, Any]] | None = None


# ---- system prompt ----

SYSTEM_PROMPT = """\
You are the iris video editing agent. You help users edit videos using AI-powered tools.

When a user asks to edit something in a video:
1. First analyze the video to understand its content (use analyze_video)
2. Identify the specific region they want to change (use identify_region)
3. Generate an edit based on their description (use generate_edit)
4. Check the job status and show results (use get_job_status)
5. If the user approves, accept the variant (use accept_variant)

Important constraints:
- Video segments for generation must be 2-5 seconds long
- Bounding boxes use normalized coordinates (0-1)
- Always confirm with the user before accepting variants

Be concise and helpful. Describe what you're doing at each step.\
"""

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
        description="Check the status of a generation job and get variant results.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "job_id": types.Schema(type=types.Type.STRING),
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
]

TOOLS = [types.Tool(function_declarations=TOOL_DECLARATIONS)]

# ---- SSE helpers ----


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a single SSE event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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
            if role not in ("user", "model"):
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
    db: AsyncSession,
    session_id: str,
    runner: Any,
) -> AsyncGenerator[str, None]:
    """Async generator that drives the Gemini agent loop and yields SSE events."""

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        yield sse_event("error", {"message": "GEMINI_API_KEY is not configured"})
        yield sse_event("done", {})
        return

    client = genai.Client(api_key=api_key)

    contents = _build_contents(body.history, body.message)

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=TOOLS,
    )

    # Agentic loop: keep calling Gemini until it stops issuing function calls
    max_turns = 10  # safety cap to prevent infinite loops
    turn = 0

    while turn < max_turns:
        turn += 1

        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=config,
            )
        except Exception as exc:
            log.exception("Gemini API call failed on turn %d", turn)
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
            yield sse_event("token", {"text": full_text})

        # If no function calls, the model is done
        if not function_calls:
            break

        # Execute each function call and collect results
        function_responses: list[types.Part] = []

        for fc in function_calls:
            tool_call_id = f"tc_{uuid.uuid4().hex[:8]}"
            tool_name = fc.name
            tool_args = dict(fc.args) if fc.args else {}

            yield sse_event("tool_call_start", {
                "id": tool_call_id,
                "tool": tool_name,
                "args": tool_args,
            })

            try:
                result = await execute_tool(
                    tool_name=tool_name,
                    args=tool_args,
                    db=db,
                    session_id=session_id,
                    runner=runner,
                )
                yield sse_event("tool_call_end", {
                    "id": tool_call_id,
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

                if tool_name == "get_job_status" and result.get("status") == "done":
                    variants = result.get("variants", [])
                    if variants:
                        yield sse_event("variant_ready", {
                            "job_id": result.get("job_id", ""),
                            "variants": variants,
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

    yield sse_event("done", {})


# ---- route ----


@router.post("/chat")
async def agent_chat(
    body: AgentChatRequest,
    request: Request,
    session: SessionModel = Depends(get_session),
    db: AsyncSession = Depends(get_db),
    runner=Depends(get_runner),
) -> StreamingResponse:
    """Stream an agent conversation with tool-calling over SSE."""
    return StreamingResponse(
        _agent_stream(
            request=request,
            body=body,
            db=db,
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
