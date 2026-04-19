"""Agent tool execution layer.

Each tool handler mirrors the logic from the corresponding API route
but operates directly on the DB session instead of going through HTTP.
This keeps the agent's tool calls in-process and avoids auth round-trips.
"""

import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.job import Job, Variant
from app.models.project import Project
from app.models.segment import Segment
from app.services import storage
from app.services.timeline_builder import build_timeline

log = logging.getLogger("iris.agent_tools")

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
