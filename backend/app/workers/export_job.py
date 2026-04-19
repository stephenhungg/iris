"""Export worker.

Composes the final MP4 by piecing together the timeline: original source
stretches + normalized generated clips. Since /api/accept already keeps
proj.video_path pointing at a stitched file that represents the full timeline,
export simply copies/re-encodes it to the exports dir.

If we later want a cleaner pipeline, this can reconstruct via concat demuxer
from the Segments table, but the stitched source is already correct.
"""
from __future__ import annotations

import logging

from app.db.session import AsyncSessionLocal
from app.models.job import Job
from app.models.project import Project
from app.services import ffmpeg, storage

log = logging.getLogger("iris.jobs.export")


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
        src_path = proj.video_path
        fps = proj.fps

    out_path, _ = storage.new_path("exports", "mp4")
    try:
        # re-encode through normalize_fps so output is always clean H.264/AAC
        await ffmpeg.normalize_fps(src_path, fps, out_path)
    except Exception as e:
        log.exception("export failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"export failed: {e}"
                await db.commit()
        return
    out_url = await storage.publish(out_path, content_type="video/mp4")

    async with AsyncSessionLocal() as db:
        j = await db.get(Job, job_id)
        if j:
            payload = dict(j.payload or {})
            payload["export_url"] = out_url
            j.payload = payload
            j.status = "done"
            await db.commit()
