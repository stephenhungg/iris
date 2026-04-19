"""Generate-variant worker.

Single-edit mode: one generation per prompt.

Flow per submitted job:
  1. flip job to 'processing'
  2. extract source clip via ffmpeg
  3. grab the reference frame + crop the bbox (Veo's image-conditioning slot)
  4. ask Gemini for a structured edit plan (we use plan[0])
  5. run one Veo generation, write the resulting Variant row
  6. score the result with Gemini (best-effort)
  7. flip job to 'done' (or 'error' if generation failed)

Every stage also publishes a structured "thought process" event through
``app.services.job_events``. The SSE route in ``app.api.routes.jobs``
relays those events to the browser so the user can watch the model's
reasoning (plan JSON, Veo op id, poll ticks, quality scores) in real time.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai import services as ai
from app.db.session import AsyncSessionLocal
from app.models.job import Job, Variant
from app.models.project import Project
from app.services import ffmpeg, job_events, storage

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


async def _emit(job_id: str, stage: str, msg: str, **data: Any) -> None:
    """Publish a typed event on the job's SSE channel."""
    event: dict[str, Any] = {"stage": stage, "msg": msg, "ts": time.time()}
    if data:
        event["data"] = data
    await job_events.publish(job_id, event)


async def _emit_terminal(job_id: str, stage: str, msg: str, **data: Any) -> None:
    event: dict[str, Any] = {
        "stage": stage,
        "msg": msg,
        "ts": time.time(),
        "terminal": True,
    }
    if data:
        event["data"] = data
    await job_events.publish(job_id, event)


async def _run_variant(
    job_id: str,
    variant_id: str,
    clip_path: Path,
    clip_url: str,
    plan: dict,
    frame_path: str | None,
) -> None:
    async with AsyncSessionLocal() as db:
        await _update_variant(db, variant_id, status="processing")

    async def tick(evt: dict[str, Any]) -> None:
        kind = evt.get("kind", "veo.tick")
        if kind == "veo.submit":
            await _emit(
                job_id,
                "veo_submit",
                f"Veo accepted the generation (op={evt.get('op')})",
                **{k: v for k, v in evt.items() if k != "kind"},
            )
        elif kind == "veo.poll":
            await _emit(
                job_id,
                "veo_poll",
                f"Veo still rendering... ({evt.get('elapsed')}s elapsed)",
                **{k: v for k, v in evt.items() if k != "kind"},
            )

    try:
        result = await ai.runway.generate(
            str(clip_path),
            plan,
            frame_path=frame_path,
            on_tick=tick,
        )
    except Exception as e:
        log.exception("variant %s failed", variant_id)
        await _emit(job_id, "veo_error", f"Veo generation failed: {e}", error=str(e)[:500])
        async with AsyncSessionLocal() as db:
            await _update_variant(db, variant_id, status="error", error=str(e)[:500])
        return

    # stubs (and some real providers) may echo the input clip path back as
    # the "url". normalise anything filesystem-y into an external URL the
    # frontend can actually load.
    raw = result.get("url") or ""
    if raw in (str(clip_path), Path(clip_path).as_posix()):
        variant_url = clip_url
        await _emit(
            job_id,
            "veo_echo",
            "provider echoed the source clip back (stub mode or no-op generation)",
        )
    else:
        variant_url = storage.normalize_url_like(raw, fallback=clip_url)

    await _emit(
        job_id,
        "veo_done",
        "Veo returned a generated clip",
        url=variant_url,
        description=result.get("description") or plan.get("description"),
    )

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
            await _emit_terminal(job_id, "error", "project missing")
            return

        await _update_job(db, job_id, status="processing")

        start_ts = float(job.start_ts or 0.0)
        end_ts = float(job.end_ts or 0.0)
        bbox = job.bbox_json or {}
        prompt = job.prompt or ""
        reference_frame_ts = float(job.reference_frame_ts or start_ts)

    bbox_w = float(bbox.get("w", 0.0))
    bbox_h = float(bbox.get("h", 0.0))
    bbox_is_full_frame = bbox_w >= 0.98 and bbox_h >= 0.98

    await _emit(
        job_id,
        "queued",
        "kicking off generation pipeline",
        project_id=proj.id,
        start_ts=start_ts,
        end_ts=end_ts,
        bbox=bbox,
        bbox_is_full_frame=bbox_is_full_frame,
        prompt=prompt,
        reference_frame_ts=reference_frame_ts,
    )

    if bbox_is_full_frame:
        await _emit(
            job_id,
            "bbox_missing",
            "no region was drawn — treating this as a full-frame regeneration. "
            "Veo regenerates the entire scene from the prompt, which gives it "
            "more freedom to honor 'remove' / 'replace' intents. For targeted "
            "tweaks (e.g. color changes on one subject) draw a tight box first.",
        )

    # extract source clip once
    await _emit(
        job_id,
        "extract_clip",
        f"slicing source from {start_ts:.2f}s to {end_ts:.2f}s",
    )
    clip_path, clip_url = storage.new_path("clips", "mp4")
    try:
        await ffmpeg.extract_clip(proj.video_path, start_ts, end_ts, clip_path)
    except Exception as e:
        log.exception("extract_clip failed")
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error=f"clip extraction failed: {e}")
        await _emit_terminal(job_id, "error", f"clip extraction failed: {e}")
        return
    clip_url = await storage.publish(clip_path, content_type="video/mp4")

    # grab a reference frame — Gemini/Veo both want a still, not the mp4.
    await _emit(job_id, "extract_frame", f"grabbing reference frame @ {reference_frame_ts:.2f}s")
    frame_path, _ = storage.new_path("keyframes", "jpg")
    frame_ok = False
    try:
        await ffmpeg.extract_frame(proj.video_path, reference_frame_ts, frame_path)
        await storage.publish(frame_path, content_type="image/jpeg")
        frame_ok = True
    except Exception as e:
        log.exception("frame extract failed (continuing without frame)")
        await _emit(job_id, "extract_frame_error", f"couldn't grab reference frame: {e}")

    # crop the bbox only so we can give Gemini a close-up reference alongside
    # the full frame — it never goes to Veo directly. Veo's image-conditioning
    # slot wants the OPENING FRAME of the video it's about to generate; if we
    # handed it a cropped rectangle it dutifully generated a video of that
    # rectangle and nothing else (the "cookie-cutter output" bug). The bbox
    # region is now expressed through prose in the Gemini plan instead.
    crop_path: Path | None = None
    if frame_ok and bbox and not bbox_is_full_frame:
        try:
            crop_path = await ffmpeg.crop_bbox_from_frame(frame_path, bbox)
            await storage.publish(crop_path, content_type="image/png")
            await _emit(
                job_id,
                "crop_bbox",
                "cropped bbox region for Gemini reference (not sent to Veo)",
                bbox=bbox,
                crop_path=str(crop_path),
            )
        except Exception as e:
            log.exception("bbox crop failed (falling back to whole frame)")
            await _emit(
                job_id,
                "crop_bbox_error",
                f"bbox crop failed, falling back to full frame: {e}",
            )
            crop_path = None

    # Veo ALWAYS gets the full frame when conditioning is used. The bbox just
    # informs Gemini's prose; Veo composes from the whole scene so the output
    # preserves surrounding context.
    conditioning_frame = str(frame_path) if frame_ok else None

    await _emit(
        job_id,
        "plan_start",
        "asking Gemini to structure the edit plan",
        user_prompt=prompt,
        bbox=bbox,
    )
    try:
        plans = await ai.gemini.plan_variants(prompt, bbox, str(frame_path))
    except Exception as e:
        log.exception("plan_variants failed")
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error=f"plan failed: {e}")
        await _emit_terminal(job_id, "error", f"plan failed: {e}")
        return

    if not plans:
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error="no plans returned")
        await _emit_terminal(job_id, "error", "Gemini returned no plans")
        return

    plan = list(plans)[0]

    # Veo 3.1 is first-frame-conditioned — it keeps whatever subject is in
    # the opening frame. For "remove/replace/restyle" intents Gemini flags
    # conditioning_strategy="text_only" so we deliberately strip the frame
    # and let Veo regenerate the scene from prose. For gentler transforms
    # we keep the frame so composition/subject stay anchored.
    intent = str(plan.get("intent") or "").lower()
    strategy = str(plan.get("conditioning_strategy") or "").lower()
    if strategy not in ("first_frame", "text_only"):
        strategy = "text_only" if intent in ("remove", "replace", "restyle") else "first_frame"

    conditioning_frame_effective: str | None
    if strategy == "text_only":
        conditioning_frame_effective = None
    else:
        conditioning_frame_effective = conditioning_frame

    # redact huge fields before shipping over SSE.
    safe_plan = {
        "description": plan.get("description"),
        "intent": intent or None,
        "conditioning_strategy": strategy,
        "tone": plan.get("tone"),
        "color_grading": plan.get("color_grading"),
        "region_emphasis": plan.get("region_emphasis"),
        "prompt_for_veo": plan.get("prompt_for_veo") or plan.get("prompt_for_runway"),
    }
    await _emit(
        job_id,
        "plan_done",
        "Gemini returned a structured edit plan",
        plan=safe_plan,
        variant_count=len(list(plans)),
    )

    # create the single Variant row so the polling endpoint sees it from t0
    async with AsyncSessionLocal() as db:
        v = Variant(job_id=job_id, index=0, status="pending")
        db.add(v)
        await db.flush()
        variant_id = v.id
        await db.commit()

    if conditioning_frame_effective:
        conditioned_on = "full_frame (bbox region described in prompt)"
    else:
        conditioned_on = "text_only (scene regenerated from prose)"

    await _emit(
        job_id,
        "veo_start",
        "dispatching prompt to Veo 3.1",
        prompt=safe_plan["prompt_for_veo"],
        strategy=strategy,
        conditioned_on=conditioned_on,
    )

    await _run_variant(
        job_id, variant_id, clip_path, clip_url, plan, conditioning_frame_effective
    )

    # collect outcome
    async with AsyncSessionLocal() as db:
        variants = (
            await db.execute(select(Variant).where(Variant.job_id == job_id))
        ).scalars().all()
        done = [v for v in variants if v.status == "done"]

    if not done:
        err = variants[0].error if variants else "generation failed"
        async with AsyncSessionLocal() as db:
            await _update_job(db, job_id, status="error", error=err or "generation failed")
        await _emit_terminal(job_id, "error", err or "generation failed")
        return

    # best-effort scoring
    await _emit(job_id, "score_start", "asking Gemini to score the variant")
    score = await _score_variant_safe([str(frame_path)], prompt)
    async with AsyncSessionLocal() as db:
        if isinstance(score, dict):
            await _update_variant(
                db,
                done[0].id,
                visual_coherence=score.get("visual_coherence"),
                prompt_adherence=score.get("prompt_adherence"),
            )
            await _emit(
                job_id,
                "score_done",
                "variant scored",
                visual_coherence=score.get("visual_coherence"),
                prompt_adherence=score.get("prompt_adherence"),
            )
        else:
            await _emit(job_id, "score_skipped", "scoring was unavailable; continuing")
        await _update_job(db, job_id, status="done")

    await _emit_terminal(
        job_id,
        "done",
        "generation complete",
        variant_url=done[0].url,
    )
