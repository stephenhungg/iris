"""Generate-variant worker.

Single-edit mode: one generation per prompt.

Flow per submitted job:
  1. flip job to 'processing'
  2. extract source clip via ffmpeg
  3. ask Gemini for a structured edit plan (we use plan[0])
  4. run one Veo generation, write the resulting Variant row
  5. score the result with Gemini (best-effort)
  6. flip job to 'done' (or 'error' if generation failed)
"""
from __future__ import annotations

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

# single-edit mode. keep the fan-out scaffolding in case we re-enable variants
# later, but only ever request one plan + one generation.
VARIANT_COUNT = 1


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
    clip_url: str,
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

    # stubs (and some real providers) may echo the input clip path back as
    # the "url". normalise anything filesystem-y into an external URL the
    # frontend can actually load.
    raw = result.get("url") or ""
    if raw in (str(clip_path), Path(clip_path).as_posix()):
        variant_url = clip_url
    else:
        variant_url = storage.normalize_url_like(raw, fallback=clip_url)

    async with AsyncSessionLocal() as db:
        await _update_variant(
            db,
            variant_id,
            status="done",
            url=variant_url,
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
    clip_url = await storage.publish(clip_path, content_type="video/mp4")

    # grab a reference frame for Gemini (used by plan + future scoring)
    frame_path, _ = storage.new_path("keyframes", "jpg")
    try:
        await ffmpeg.extract_frame(proj.video_path, reference_frame_ts, frame_path)
        await storage.publish(frame_path, content_type="image/jpeg")
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

    plan = list(plans)[0]

    # create the single Variant row so the polling endpoint sees it from t0
    async with AsyncSessionLocal() as db:
        v = Variant(job_id=job_id, index=0, status="pending")
        db.add(v)
        await db.flush()
        variant_id = v.id
        await db.commit()

    await _run_variant(variant_id, clip_path, clip_url, plan)

    # collect outcome
    async with AsyncSessionLocal() as db:
        variants = (
            await db.execute(select(Variant).where(Variant.job_id == job_id))
        ).scalars().all()
        done = [v for v in variants if v.status == "done"]

    if not done:
        async with AsyncSessionLocal() as db:
            err = variants[0].error if variants else "generation failed"
            await _update_job(db, job_id, status="error", error=err or "generation failed")
        return

    # best-effort scoring
    score = await _score_variant_safe([str(frame_path)], prompt)
    async with AsyncSessionLocal() as db:
        if isinstance(score, dict):
            await _update_variant(
                db,
                done[0].id,
                visual_coherence=score.get("visual_coherence"),
                prompt_adherence=score.get("prompt_adherence"),
            )
        await _update_job(db, job_id, status="done")
