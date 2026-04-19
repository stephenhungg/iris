"""Agent tool execution layer.

Each tool handler mirrors the logic from the corresponding API route
but operates directly on the DB session instead of going through HTTP.
This keeps the agent's tool calls in-process and avoids auth round-trips.
"""

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job import Job, Variant
from app.models.project import Project
from app.models.segment import Segment
from app.models.timeline_snapshot import TimelineSnapshot
from app.services import color as color_service
from app.services import ffmpeg, storage
from app.services.timeline_builder import build_timeline
from google import genai
from google.genai import types

log = logging.getLogger("iris.agent_tools")

MIN_SEG_LEN = 2.0
MAX_SEG_LEN = 5.0
MAX_BATCH_EDITS = 10
GEMINI_MODEL = "gemini-2.5-flash"
FRAME_COUNT = 5

# ---- dispatcher ----

TOOL_HANDLERS: dict[str, Any] = {}


def _register(name: str):
    """Decorator to register a tool handler by name."""
    def decorator(fn):
        TOOL_HANDLERS[name] = fn
        return fn
    return decorator


async def execute_tool(
    tool_name: str,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Dispatch a tool call to the appropriate handler.

    Args:
        tool_name: Name of the tool to execute.
        args: Tool arguments from the Gemini function call.
        db: Active async DB session.
        session_id: Current user session ID for ownership checks.
        runner: Optional JobRunner for submitting background tasks.

    Returns:
        Dict with the tool execution result.

    Raises:
        ValueError: If the tool name is not recognized.
    """
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        raise ValueError(f"unknown tool: {tool_name}")
    return await handler(args=args, db=db, session_id=session_id, runner=runner)


# ---- ownership check helper ----

async def _get_project_or_error(
    db: AsyncSession,
    project_id: str,
    session_id: str,
) -> Project:
    """Fetch a project and verify session ownership."""
    proj = await db.get(Project, project_id)
    if proj is None or proj.session_id != session_id:
        raise ValueError(f"project not found or access denied: {project_id}")
    return proj


async def _get_segment_or_error(
    db: AsyncSession,
    project_id: str,
    segment_id: str,
) -> Segment:
    segment = await db.get(Segment, segment_id)
    if segment is None or segment.project_id != project_id:
        raise ValueError(f"segment not found: {segment_id}")
    return segment


async def _get_owned_segment_or_error(
    db: AsyncSession,
    segment_id: str,
    session_id: str,
) -> tuple[Segment, Project]:
    row = (
        await db.execute(
            select(Segment, Project)
            .join(Project, Project.id == Segment.project_id)
            .where(
                Segment.id == segment_id,
                Project.session_id == session_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise ValueError(f"segment not found: {segment_id}")
    segment, project = row
    return segment, project


async def _get_variant_for_session_or_error(
    db: AsyncSession,
    variant_id: str,
    session_id: str,
) -> Variant:
    variant = (
        await db.execute(
            select(Variant)
            .where(Variant.id == variant_id)
            .options(
                selectinload(Variant.job).selectinload(Job.project),
            )
        )
    ).scalar_one_or_none()
    if variant is None or variant.job is None or variant.job.project is None:
        raise ValueError(f"variant not found: {variant_id}")
    if variant.job.project.session_id != session_id:
        raise ValueError(f"variant not found: {variant_id}")
    return variant


def _segment_dict(segment: Segment) -> dict[str, Any]:
    return {
        "id": segment.id,
        "project_id": segment.project_id,
        "start_ts": segment.start_ts,
        "end_ts": segment.end_ts,
        "source": segment.source,
        "url": storage.normalize_url_like(segment.url, fallback=segment.url),
        "variant_id": segment.variant_id,
        "order_index": segment.order_index,
        "active": segment.active,
    }


def _snapshot_payload(segment: Segment) -> dict[str, Any]:
    return {
        "project_id": segment.project_id,
        "start_ts": segment.start_ts,
        "end_ts": segment.end_ts,
        "source": segment.source,
        "url": segment.url,
        "variant_id": segment.variant_id,
        "order_index": segment.order_index,
        "active": segment.active,
    }


def _validate_preview_timestamp(ts: float, duration: float) -> None:
    if ts < 0:
        raise ValueError("ts must be >= 0")
    if ts > duration + 1e-3:
        raise ValueError("ts past project duration")


def _validate_preview_bounds(start: float, end: float, duration: float) -> None:
    if end <= start:
        raise ValueError("end must be greater than start")
    if start < 0:
        raise ValueError("start must be >= 0")
    if end > duration + 1e-3:
        raise ValueError("end past project duration")


def _validate_segment_length(start_ts: float, end_ts: float) -> None:
    length = end_ts - start_ts
    if length < MIN_SEG_LEN or length > MAX_SEG_LEN:
        raise ValueError(
            f"segment length must be {MIN_SEG_LEN}-{MAX_SEG_LEN}s (got {length:.2f}s)"
        )


def _validate_bbox_bounds(bbox: dict[str, Any]) -> None:
    x = float(bbox.get("x", 0.0))
    y = float(bbox.get("y", 0.0))
    w = float(bbox.get("w", 0.0))
    h = float(bbox.get("h", 0.0))
    if x + w > 1.0001 or y + h > 1.0001:
        raise ValueError("bbox extends outside the frame")


def _find_timeline_item(items: list[Any], ts: float) -> Any:
    for item in items:
        if item.start_ts - 1e-3 <= ts < item.end_ts - 1e-3:
            return item
    if items and abs(ts - items[-1].end_ts) <= 1e-3:
        return items[-1]
    raise ValueError("timeline item not found")


async def _resolve_timeline_source_path(
    proj: Project,
    item: Any,
) -> Path:
    if item.source == "generated":
        return await storage.path_from_url(item.url)

    src = Path(proj.video_path)
    if src.exists():
        return src
    return await storage.path_from_url(proj.video_url)


async def _extract_preview_frame_result(
    proj: Project,
    items: list[Any],
    ts: float,
) -> dict[str, Any]:
    item = _find_timeline_item(items, ts)
    src = await _resolve_timeline_source_path(proj, item)
    if item.source == "generated":
        frame_ts = max(0.0, ts - item.start_ts)
        frame_ts = min(frame_ts, max(0.0, item.duration - 1e-3))
    else:
        frame_ts = min(ts, max(0.0, proj.duration - 1e-3))

    frame_path, _ = storage.new_path("previews", "jpg")
    await ffmpeg.extract_frame(src, frame_ts, frame_path)
    frame_url = await storage.publish(frame_path, content_type="image/jpeg")
    return {"ts": ts, "url": frame_url}


async def _deactivate_overlapping_generated_segments(
    db: AsyncSession,
    segment: Segment,
) -> None:
    overlapping = (
        await db.execute(
            select(Segment).where(
                Segment.project_id == segment.project_id,
                Segment.active == True,  # noqa: E712
                Segment.source == "generated",
                Segment.start_ts < segment.end_ts,
                Segment.end_ts > segment.start_ts,
            )
        )
    ).scalars().all()
    for existing in overlapping:
        existing.active = False


def _get_gemini_client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=api_key)


def _image_part(path: Path) -> types.Part:
    suffix = path.suffix.lower()
    mime_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix, "image/png")
    return types.Part.from_bytes(data=path.read_bytes(), mime_type=mime_type)


def _score_prompt(compare_to: str, prompt: str) -> str:
    if compare_to == "original":
        comparison_instruction = (
            "you are also given reference frames from the original source segment. "
            "judge whether the variant preserves scene structure and improves the edit "
            "without introducing new artifacts or continuity breaks."
        )
    else:
        comparison_instruction = (
            "judge the variant directly against the user prompt without assuming access "
            "to the original source segment."
        )

    return (
        "you are a video quality rater for short generated clips. "
        f"{comparison_instruction} "
        "return strict json only using this schema: "
        "{"
        '"visual_coherence":{"score":float,"issues":[str]},'
        '"prompt_adherence":{"score":float,"misses":[str]},'
        '"temporal_consistency":{"score":float,"flicker_detected":bool},'
        '"edge_quality":{"score":float,"issues":[str]},'
        '"overall":float,'
        '"recommendation":"accept"|"remix"|"reject"'
        "}. "
        "all scores must be floats from 0.0 to 10.0. "
        "keep issue and miss lists concise and concrete. "
        f"user prompt: {prompt}"
    )


def _continuity_prompt(boundary_ts: float) -> str:
    return (
        "you are judging continuity across a video edit boundary. "
        f"the first image is the last frame before the cut near t={boundary_ts:.3f}s. "
        "the second image is the first frame after the cut. "
        "return strict json only using this schema: "
        '{'
        '"score":float,'
        '"issues":[{"type":str,"severity":float}]'
        "}. "
        "scores and severities must be floats from 0.0 to 10.0. "
        "only include issues for meaningful continuity problems like jump cuts, "
        "subject mismatch, lighting change, color shift, framing mismatch, or object pop."
    )


async def _generate_json(
    *,
    client: genai.Client,
    prompt_text: str,
    frame_paths: list[Path],
) -> dict[str, Any]:
    contents = [types.Part.from_text(text=prompt_text)]
    contents.extend(_image_part(path) for path in frame_paths)

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    return json.loads(response.text)


async def _sample_video_frames(
    *,
    src: Path,
    temp_dir: Path,
    prefix: str,
    num_frames: int,
    start_ts: float = 0.0,
    end_ts: float | None = None,
) -> list[Path]:
    probe_data = await ffmpeg.probe(src)
    duration = float(probe_data.get("duration", 0.0))
    sample_start = max(0.0, start_ts)
    sample_end = duration if end_ts is None else min(float(end_ts), duration)
    if sample_end <= sample_start:
        sample_end = max(sample_start + 1e-3, duration)

    span = max(sample_end - sample_start, 1e-3)
    frame_paths: list[Path] = []
    for index in range(num_frames):
        ts = sample_start + ((index + 0.5) * span / num_frames)
        ts = min(max(sample_start, ts), max(sample_start, sample_end - 1e-3))
        out = temp_dir / f"{prefix}_{index:02d}.png"
        await ffmpeg.extract_frame(src, ts, out)
        frame_paths.append(out)
    return frame_paths


async def _boundary_frame(
    *,
    proj: Project,
    item: Any,
    is_end: bool,
    output_path: Path,
) -> Path:
    clip_path = await _resolve_timeline_source_path(proj, item)
    if not clip_path.exists():
        raise ValueError("timeline source video not found")

    epsilon = min(0.04, max(item.duration / 10.0, 0.001))
    if item.source == "original":
        ts = max(0.0, item.end_ts - epsilon) if is_end else max(0.0, item.start_ts)
    else:
        ts = max(0.0, item.duration - epsilon) if is_end else 0.0
    return await ffmpeg.extract_frame(clip_path, ts, output_path)


# ---- tool handlers ----

@_register("analyze_video")
async def _analyze_video(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Stub: analyze video content by sampling frames.

    The real multi-agent analysis pipeline will replace this later.
    For now, return project metadata as a placeholder.
    """
    project_id: str = args["project_id"]
    fps: float = args.get("fps", 1.0)

    proj = await _get_project_or_error(db, project_id, session_id)

    return {
        "status": "done",
        "project_id": proj.id,
        "duration": proj.duration,
        "fps_sampled": fps,
        "frame_count": int(proj.duration * fps),
        "analysis": {
            "description": (
                "Video analysis is a placeholder. The full multi-agent pipeline "
                "will extract frames, identify scenes, objects, entities, mood, "
                "and lighting in a future update."
            ),
            "scenes": [],
            "entities": [],
        },
    }


@_register("identify_region")
async def _identify_region(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Identify what entity is inside a bounding box at a given timestamp.

    Mirrors the logic of POST /api/identify.
    """
    from ai.services import gemini
    from ai.services.ffmpeg import extract_frame, crop_bbox_from_frame
    from app.config.settings import get_settings

    project_id: str = args["project_id"]
    frame_ts: float = args["frame_ts"]
    bbox: dict[str, float] = args["bbox"]

    proj = await _get_project_or_error(db, project_id, session_id)

    if frame_ts > proj.duration + 1e-3:
        raise ValueError(f"frame_ts {frame_ts} exceeds project duration {proj.duration}")

    if bbox.get("x", 0) + bbox.get("w", 0) > 1.0001 or bbox.get("y", 0) + bbox.get("h", 0) > 1.0001:
        raise ValueError("bbox extends outside the frame")

    settings = get_settings()
    frames_dir = settings.storage_path / "identify_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    frame_path = str(frames_dir / f"{proj.id}_{frame_ts:.3f}.png")
    try:
        extract_frame(proj.video_path, frame_ts, frame_path)
    except Exception as exc:
        raise ValueError(f"frame extraction failed: {exc}") from exc

    try:
        crop_path = crop_bbox_from_frame(frame_path, bbox)
    except Exception as exc:
        raise ValueError(f"bbox crop failed: {exc}") from exc

    try:
        entity = await gemini.identify_entity(crop_path)
    except Exception as exc:
        raise ValueError(f"entity identification failed: {exc}") from exc

    # cleanup temp files
    for path in (frame_path, crop_path):
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            pass

    return {
        "description": entity.get("description", ""),
        "category": entity.get("category", ""),
        "attributes": entity.get("attributes", {}),
    }


@_register("generate_edit")
async def _generate_edit(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Create a generate job — mirrors POST /api/generate logic."""
    from app.workers import generate_job as generate_worker

    project_id: str = args["project_id"]
    start_ts: float = args["start_ts"]
    end_ts: float = args["end_ts"]
    bbox: dict[str, float] = args["bbox"]
    prompt: str = args["prompt"]
    reference_frame_ts: float = args.get("reference_frame_ts", start_ts)

    proj = await _get_project_or_error(db, project_id, session_id)

    length = end_ts - start_ts
    if length < 2.0 or length > 5.0:
        raise ValueError(f"segment length must be 2-5s (got {length:.2f}s)")
    if end_ts > proj.duration + 1e-3:
        raise ValueError("end_ts past project duration")
    if bbox.get("x", 0) + bbox.get("w", 0) > 1.0001 or bbox.get("y", 0) + bbox.get("h", 0) > 1.0001:
        raise ValueError("bbox extends outside the frame")

    job = Job(
        project_id=proj.id,
        kind="generate",
        status="pending",
        start_ts=start_ts,
        end_ts=end_ts,
        bbox_json=bbox,
        prompt=prompt,
        reference_frame_ts=reference_frame_ts,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    if runner is not None:
        runner.submit(job.id, lambda: generate_worker.run(job.id))

    return {
        "job_id": job.id,
        "status": "pending",
        "message": f"Generation job created for segment {start_ts:.1f}s–{end_ts:.1f}s",
    }


@_register("get_job_status")
async def _get_job_status(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Fetch job status + variants — mirrors GET /api/jobs/{job_id}."""
    job_id: str = args["job_id"]

    job = (
        await db.execute(
            select(Job).where(Job.id == job_id).options(selectinload(Job.variants))
        )
    ).scalar_one_or_none()
    if job is None:
        raise ValueError(f"job not found: {job_id}")

    proj = await db.get(Project, job.project_id)
    if proj is None or proj.session_id != session_id:
        raise ValueError(f"job not found: {job_id}")

    variants = [
        {
            "id": v.id,
            "index": v.index,
            "status": v.status,
            "url": v.url,
            "description": v.description,
            "visual_coherence": v.visual_coherence,
            "prompt_adherence": v.prompt_adherence,
            "error": v.error,
        }
        for v in sorted(job.variants, key=lambda v: v.index)
    ]

    return {
        "job_id": job.id,
        "kind": job.kind,
        "status": job.status,
        "error": job.error,
        "variants": variants,
    }


@_register("accept_variant")
async def _accept_variant(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Accept a variant and apply it to the timeline — mirrors POST /api/accept."""
    from app.workers import entity_job

    job_id: str = args["job_id"]
    variant_index: int = args.get("variant_index", 0)

    job = (
        await db.execute(
            select(Job).where(Job.id == job_id).options(selectinload(Job.variants))
        )
    ).scalar_one_or_none()
    if job is None:
        raise ValueError(f"job not found: {job_id}")

    proj = await db.get(Project, job.project_id)
    if proj is None or proj.session_id != session_id:
        raise ValueError(f"job not found: {job_id}")

    variant: Variant | None = next(
        (v for v in job.variants if v.index == variant_index), None
    )
    if variant is None or variant.status != "done" or not variant.url:
        raise ValueError("variant not ready")

    if job.start_ts is None or job.end_ts is None:
        raise ValueError("job has no segment range")

    # deactivate overlapping generated segments
    overlapping = (
        await db.execute(
            select(Segment).where(
                Segment.project_id == proj.id,
                Segment.active == True,  # noqa: E712
                Segment.source == "generated",
                Segment.start_ts < job.end_ts,
                Segment.end_ts > job.start_ts,
            )
        )
    ).scalars().all()
    for s in overlapping:
        s.active = False

    seg = Segment(
        project_id=proj.id,
        start_ts=job.start_ts,
        end_ts=job.end_ts,
        source="generated",
        url=variant.url,
        variant_id=variant.id,
        order_index=int(job.start_ts * 1000),
        active=True,
    )
    db.add(seg)
    await db.commit()
    await db.refresh(seg)

    # fire entity-search background job
    ent_job = Job(
        project_id=proj.id,
        kind="entity",
        status="pending",
        payload={
            "segment_id": seg.id,
            "reference_frame_ts": job.reference_frame_ts,
            "reference_variant_url": variant.url,
            "bbox": job.bbox_json,
        },
    )
    db.add(ent_job)
    await db.commit()
    await db.refresh(ent_job)

    if runner is not None:
        runner.submit(ent_job.id, lambda: entity_job.run(ent_job.id))

    return {
        "segment_id": seg.id,
        "entity_job_id": ent_job.id,
        "message": f"Variant {variant_index} accepted and applied to timeline",
    }


@_register("get_timeline")
async def _get_timeline(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Fetch the project timeline — mirrors GET /api/timeline/{project_id}."""
    project_id: str = args["project_id"]

    proj = await _get_project_or_error(db, project_id, session_id)
    items = await build_timeline(db, proj)

    return {
        "project_id": proj.id,
        "duration": proj.duration,
        "segments": [
            {
                "start_ts": it.start_ts,
                "end_ts": it.end_ts,
                "source": it.source,
                "url": storage.normalize_url_like(it.url, fallback=it.url),
                "audio": it.audio,
            }
            for it in items
        ],
    }


@_register("export_video")
async def _export_video(
    *,
    args: dict[str, Any],
    db: AsyncSession,
    session_id: str,
    runner: Any | None = None,
) -> dict[str, Any]:
    """Create an export job — mirrors POST /api/export."""
    from app.workers import export_job as export_worker

    project_id: str = args["project_id"]

    proj = await _get_project_or_error(db, project_id, session_id)

    job = Job(
        project_id=proj.id,
        kind="export",
        status="pending",
        payload={"format": "mp4"},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    if runner is not None:
        runner.submit(job.id, lambda: export_worker.run(job.id))

    return {
        "export_job_id": job.id,
        "status": "pending",
        "message": "Export job created — check status with get_job_status",
    }
