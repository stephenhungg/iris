"""Generate-variant worker.

Flow per submitted job:
  1. flip job to 'processing'
  2. extract clip via ffmpeg
  3. ask Gemini for 3 structured edit plans
  4. fan out 3 Runway calls with asyncio.gather, write each Variant row as it lands
  5. once all settle, score variants with Gemini and persist scores
  6. flip job to 'done' (or 'error' if < 2 variants succeeded)
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai import services as ai
from app.db.session import AsyncSessionLocal
from app.models.job import Job, Variant
from app.models.project import Project
from app.services import ffmpeg, storage

log = logging.getLogger("iris.jobs.generate")

VARIANT_COUNT = 3
MIN_SUCCESS = 2


async def _update_job(db: AsyncSession, job_id: str, **fields) -> None:
    job = await db.get(Job, job_id)
    if job is None:
        return
    for k, v in fields.items():
        setattr(job, k, v)
    await db.commit()


async def _update_variant(db: AsyncSession, variant_id: str, **fields) -> None:
    v = await db.get(Variant, variant_id)
    if v is None:
        return
    for k, v2 in fields.items():
        setattr(v, k, v2)
    await db.commit()


async def _run_variant(
    variant_id: str,
    clip_path: Path,
    plan: dict,
) -> None:
    async with AsyncSessionLocal() as db:
        await _update_variant(db, variant_id, status="processing")
    try:
        result = await ai.runway.generate(str(clip_path), plan)
    except Exception as e:
        log.exception("variant %s failed", variant_id)
        async with AsyncSessionLocal() as db:
            await _update_variant(db, variant_id, status="error", error=str(e)[:500])
        return

    async with AsyncSessionLocal() as db:
        await _update_variant(
            db,
            variant_id,
            status="done",
            url=result["url"],
            description=result.get("description") or plan.get("description"),
        )


async def _score_variant_safe(frames: list[str], prompt: str) -> dict | None:
    try:
        return await ai.gemini.score_variant(frames, prompt)
    except Exception:
        log.exception("scoring failed")
        return None


async def run(job_id: str) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            log.warning("generate job %s missing", job_id)
            return
        proj = await db.get(Project, job.project_id)
        if proj is None:
            await _update_job(db, job_id, status="error", error="project missing")
            return

        await _update_job(db, job_id, status="processing")

        start_ts = float(job.start_ts or 0.0)
        end_ts = float(job.end_ts or 0.0)
        bbox = job.bbox_json or {}
        prompt = job.prompt or ""
        reference_frame_ts = float(job.reference_frame_ts or start_ts)

    # extract source clip once
    clip_path, clip_url = storage.new_path("clips", "mp4")
    try:
        await ffmpeg.extract_clip(proj.video_path, start_ts, end_ts, clip_path)
    except Exception as e:
        log.exception("extract_clip failed")
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error=f"clip extraction failed: {e}")
        return

    # grab a reference frame for Gemini (used by plan + future scoring)
    frame_path, _ = storage.new_path("keyframes", "jpg")
    try:
        await ffmpeg.extract_frame(proj.video_path, reference_frame_ts, frame_path)
    except Exception:
        log.exception("frame extract failed (continuing without frame)")

    try:
        plans = await ai.gemini.plan_variants(prompt, bbox, str(frame_path))
    except Exception as e:
        log.exception("plan_variants failed")
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error=f"plan failed: {e}")
        return

    if not plans:
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error="no plans returned")
        return

    plans = list(plans)[:VARIANT_COUNT]
    while len(plans) < VARIANT_COUNT:
        plans.append(plans[-1])  # never happens unless the stub returns too few

    # create Variant rows up-front so the polling endpoint sees all 3 slots
    variant_ids: list[str] = []
    async with AsyncSessionLocal() as db:
        for i in range(VARIANT_COUNT):
            v = Variant(job_id=job_id, index=i, status="pending")
            db.add(v)
            await db.flush()
            variant_ids.append(v.id)
        await db.commit()

    # fan out
    await asyncio.gather(
        *[_run_variant(variant_ids[i], clip_path, plans[i]) for i in range(VARIANT_COUNT)],
        return_exceptions=True,
    )

    # collect outcomes
    async with AsyncSessionLocal() as db:
        variants = (
            await db.execute(select(Variant).where(Variant.job_id == job_id))
        ).scalars().all()
        done = [v for v in variants if v.status == "done"]

    if len(done) < MIN_SUCCESS:
        async with AsyncSessionLocal() as db:
            await _update_job(
                db,
                job_id,
                status="error",
                error=f"only {len(done)}/{VARIANT_COUNT} variants succeeded",
            )
        return

    # score in parallel (best-effort)
    scores = await asyncio.gather(
        *[_score_variant_safe([str(frame_path)], prompt) for _ in done],
        return_exceptions=True,
    )
    async with AsyncSessionLocal() as db:
        for v, score in zip(done, scores):
            if isinstance(score, dict):
                await _update_variant(
                    db,
                    v.id,
                    visual_coherence=score.get("visual_coherence"),
                    prompt_adherence=score.get("prompt_adherence"),
                )

        await _update_job(db, job_id, status="done")
