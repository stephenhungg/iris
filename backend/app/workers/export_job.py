"""Export worker.

Renders the final MP4 by compositing the project's timeline from scratch:
original stretches extracted from the source video + generated variant
clips, each normalized to the project's fps + resolution so the concat
demuxer can stitch them without re-encoding the seams.

This is the *only* place where a full-project re-encode happens. Accept
and propagate just write Segment rows; we do the real ffmpeg work here.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from app.db.session import AsyncSessionLocal
from app.models.job import Job
from app.models.project import Project
from app.services import ffmpeg, storage
from app.services.ffmpeg import _run  # type: ignore[attr-defined]
from app.services.timeline_builder import TimelineItem, build_timeline

log = logging.getLogger("iris.jobs.export")


async def _render_span(
    src: Path,
    *,
    span_start: float,
    span_end: float,
    target_w: int,
    target_h: int,
    target_fps: float,
    out: Path,
    is_generated: bool,
) -> None:
    """Produce a unit-codec MP4 for one timeline span.

    Every output is h264 + aac + exact target w/h/fps so concat_mp4s can
    glue them without re-encoding a second time. The scale filter letter-
    boxes rather than crop so aspect-mismatched AI variants don't distort.
    """
    # generated clips play their own full span (variant file == segment);
    # original clips seek into the source for [span_start, span_end].
    seek_in = [] if is_generated else ["-ss", f"{span_start:.3f}"]
    seek_out = (
        []
        if is_generated
        else ["-to", f"{span_end - span_start + span_start:.3f}"]
    )
    # for generated we use -to on the variant's own timeline
    if is_generated:
        seek_out = ["-to", f"{span_end - span_start:.3f}"]

    vf = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"fps={target_fps:.4f}"
    )
    cmd = [
        "ffmpeg", "-y",
        *seek_in,
        *seek_out,
        "-i", str(src),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        # guarantee an audio track exists even if the variant is silent,
        # otherwise concat demuxer barfs on missing streams.
        "-af", "apad",
        "-shortest",
        str(out),
    ]
    await _run(cmd)


async def _render_timeline(
    items: list[TimelineItem],
    proj: Project,
) -> Path:
    """Materialize the ordered timeline items into a single MP4."""
    scratch_parts: list[Path] = []
    render_id = uuid.uuid4().hex[:12]

    for i, item in enumerate(items):
        part_path = storage.path_for("exports", f"_part_{render_id}_{i:04d}.mp4")
        is_generated = item.source == "generated"

        if is_generated:
            src = await storage.path_from_url(item.url)
        else:
            # originals always come from the project's source video
            src = Path(proj.video_path)
            if not src.exists():
                # scratch was wiped; pull the source back from S3
                src = await storage.path_from_url(proj.video_url)

        await _render_span(
            src,
            span_start=item.start_ts,
            span_end=item.end_ts,
            target_w=proj.width or 1280,
            target_h=proj.height or 720,
            target_fps=proj.fps or 24.0,
            out=part_path,
            is_generated=is_generated,
        )
        scratch_parts.append(part_path)

    out_path, _ = storage.new_path("exports", "mp4")

    if len(scratch_parts) == 1:
        # single span — skip the concat step, just rename the part
        scratch_parts[0].rename(out_path)
    else:
        await ffmpeg.concat_mp4s(scratch_parts, out_path)
        # clean up intermediates immediately; they're no longer needed
        for p in scratch_parts:
            try:
                p.unlink()
            except OSError:
                pass

    return out_path


async def run(job_id: str) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        proj = await db.get(Project, job.project_id)
        if proj is None:
            job.status = "error"
            job.error = "project missing"
            await db.commit()
            return
        job.status = "processing"
        await db.commit()

        items = await build_timeline(db, proj)
        proj_copy = proj  # keep the loaded instance for ffmpeg params

    try:
        out_path = await _render_timeline(items, proj_copy)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.exception("export failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"export failed: {e}"
                await db.commit()
        return

    try:
        out_url = await storage.publish(out_path, content_type="video/mp4")
    except Exception as e:
        log.exception("export publish failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"export publish failed: {e}"
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        j = await db.get(Job, job_id)
        if j:
            payload = dict(j.payload or {})
            payload["export_url"] = out_url
            j.payload = payload
            j.status = "done"
            await db.commit()
