"""Entity search worker.

Runs after /api/accept. Extracts keyframes from the project video, asks Gemini
to identify the entity from the reference crop, and finds other occurrences.
Results persist as EntityAppearance rows tied to a single Entity.
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select

from ai import services as ai
from app.db.session import AsyncSessionLocal
from app.models.entity import Entity, EntityAppearance
from app.models.job import Job
from app.models.project import Project
from app.services import ffmpeg, storage

log = logging.getLogger("iris.jobs.entity")

KEYFRAMES_PER_SECOND = 1.0


async def run(job_id: str) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        payload = job.payload or {}
        project_id = job.project_id
        segment_id = payload.get("segment_id")
        reference_crop_path = payload.get("reference_crop_path")
        reference_variant_url = payload.get("reference_variant_url")

        proj = await db.get(Project, project_id)
        if proj is None:
            job.status = "error"
            job.error = "project missing"
            await db.commit()
            return
        job.status = "processing"
        await db.commit()

    try:
        identity = await ai.gemini.identify_entity(reference_crop_path or "")
    except Exception as e:
        log.exception("identify_entity failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"identify failed: {e}"
                await db.commit()
        return

    # create the Entity row
    async with AsyncSessionLocal() as db:
        entity = Entity(
            project_id=project_id,
            source_segment_id=segment_id,
            description=identity["description"],
            category=identity.get("category"),
            attributes_json=identity.get("attributes") or {},
            reference_crop_url=storage.url_for_path(Path(reference_crop_path))
            if reference_crop_path and Path(reference_crop_path).exists()
            else None,
            reference_variant_url=reference_variant_url,
        )
        db.add(entity)
        await db.flush()
        entity_id = entity.id

        # stash the entity_id on the job.payload so the accept route can surface it
        j = await db.get(Job, job_id)
        if j:
            payload2 = dict(j.payload or {})
            payload2["entity_id"] = entity_id
            j.payload = payload2
        await db.commit()

    # sample keyframes
    try:
        pattern, _ = storage.new_path("keyframes", "jpg")
        # ffmpeg wants a %04d pattern; rewrite the name
        pattern = pattern.with_name(f"{pattern.stem}_%04d.jpg")
        keyframes = await ffmpeg.extract_keyframes(
            proj.video_path, KEYFRAMES_PER_SECOND, pattern
        )
        keyframe_urls = []
        for p in keyframes:
            keyframe_urls.append(await storage.publish(p, content_type="image/jpeg"))
    except Exception as e:
        log.exception("keyframe extraction failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"keyframes failed: {e}"
                await db.commit()
        return

    try:
        hits = await ai.gemini.find_entity_in_keyframes(identity, keyframe_urls)
    except Exception as e:
        log.exception("find_entity_in_keyframes failed")
        async with AsyncSessionLocal() as db:
            j = await db.get(Job, job_id)
            if j:
                j.status = "error"
                j.error = f"search failed: {e}"
                await db.commit()
        return

    async with AsyncSessionLocal() as db:
        for h in hits:
            app = EntityAppearance(
                entity_id=entity_id,
                segment_id=None,
                start_ts=h["start_ts"],
                end_ts=h["end_ts"],
                keyframe_url=h.get("keyframe_url"),
                confidence=h.get("confidence", 0.0),
            )
            db.add(app)

        j = await db.get(Job, job_id)
        if j:
            j.status = "done"
        await db.commit()
