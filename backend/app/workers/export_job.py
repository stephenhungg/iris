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
from app.schemas.timeline import PersistedEDL

log = logging.getLogger("iris.jobs.export")


async def _render_clip(
    src: Path,
    *,
    source_start: float,
    source_end: float,
    volume: float,
    target_w: int,
    target_h: int,
    target_fps: float,
    out: Path,
) -> None:
    """Produce a unit-codec MP4 for one clip span.

    Takes source-file times (not timeline times) — caller is responsible
    for knowing how deep into the source to seek. Every output is h264 +
    aac + exact target w/h/fps so concat_mp4s can glue them without
    re-encoding the seams. The scale filter letterboxes rather than crop
    so aspect-mismatched AI variants don't distort.

    volume: 0.0 silences the clip, 1.0 plays as-is, anything in between
    attenuates. Silenced clips still get a padded silent track so concat
    doesn't choke on missing streams.
    """
    duration = max(0.0, source_end - source_start)
    vf = (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"fps={target_fps:.4f}"
    )
    # multi-filter on audio: volume scale + pad silence to the full span
    # so the result always has the same stream layout for the concat step.
    af_parts: list[str] = []
    if volume < 0.999:
        af_parts.append(f"volume={max(0.0, min(1.0, volume)):.3f}")
    af_parts.append("apad")
    af = ",".join(af_parts)

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{source_start:.3f}",
        "-to", f"{source_start + duration:.3f}",
        "-i", str(src),
        "-vf", vf,
        "-af", af,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "48000",
        "-ac", "2",
        "-movflags", "+faststart",
        "-shortest",
        str(out),
    ]
    await _run(cmd)


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
    """Legacy shim for the non-EDL path. Treats the full generated file as
    playing from 0, and originals as seeking into the source for
    [span_start, span_end]. Volume is always 1.0 in this path."""
    if is_generated:
        source_start = 0.0
        source_end = max(0.0, span_end - span_start)
    else:
        source_start = span_start
        source_end = span_end
    await _render_clip(
        src,
        source_start=source_start,
        source_end=source_end,
        volume=1.0,
        target_w=target_w,
        target_h=target_h,
        target_fps=target_fps,
        out=out,
    )


async def _render_edl(
    edl: PersistedEDL,
    proj: Project,
) -> Path:
    """Render a saved EDL snapshot — clip-by-clip, honoring splits/trims,
    reorders, and per-clip volume. This is the path taken whenever the
    user has touched the timeline in the studio; the DB's timeline_edl
    column is the source of truth for shape, segments table is only used
    as an index into which variant files exist."""
    scratch_parts: list[Path] = []
    render_id = uuid.uuid4().hex[:12]

    for i, clip in enumerate(edl.clips):
        if clip.source_end - clip.source_start < 0.02:
            # user trimmed almost to zero — skip to avoid zero-length mp4s
            continue
        part_path = storage.path_for("exports", f"_part_{render_id}_{i:04d}.mp4")

        # prefer the local scratch copy of the project's own video when
        # the clip points at it (spares us a re-download per clip). every
        # other source (generated variant, uploaded library asset) goes
        # through path_from_url which caches to scratch.
        src = Path(proj.video_path) if clip.url == proj.video_url else None
        if src is None or not src.exists():
            src = await storage.path_from_url(clip.url)

        await _render_clip(
            src,
            source_start=clip.source_start,
            source_end=clip.source_end,
            volume=clip.volume,
            target_w=proj.width or 1280,
            target_h=proj.height or 720,
            target_fps=proj.fps or 24.0,
            out=part_path,
        )
        scratch_parts.append(part_path)

    out_path, _ = storage.new_path("exports", "mp4")
    if not scratch_parts:
        raise RuntimeError("edl rendered to zero clips — nothing to export")
    if len(scratch_parts) == 1:
        scratch_parts[0].rename(out_path)
    else:
        await ffmpeg.concat_mp4s(scratch_parts, out_path)
        for p in scratch_parts:
            try:
                p.unlink()
            except OSError:
                pass
    return out_path


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

        # Prefer the saved EDL when present — this is what the user saw
        # in the studio, complete with splits/trims/reorders/volume. Fall
        # back to the segment-based reconstruction for legacy reels that
        # were never touched after upload.
        edl_blob = proj.timeline_edl
        edl: PersistedEDL | None = None
        if edl_blob:
            try:
                edl = PersistedEDL.model_validate(edl_blob)
            except Exception:
                log.warning("project %s has malformed timeline_edl; falling back to segments", proj.id)
                edl = None

        items: list[TimelineItem] | None = None
        if edl is None:
            items = await build_timeline(db, proj)

        proj_copy = proj  # keep the loaded instance for ffmpeg params

    try:
        if edl is not None:
            out_path = await _render_edl(edl, proj_copy)
        else:
            assert items is not None
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
