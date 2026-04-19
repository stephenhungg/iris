"""ai/services facade.

This module defines the stable surface that [backend/app/workers/](backend/app/workers/)
imports. The backend expects:

    gemini.plan_variants(prompt, bbox, frame_path) -> list[EditPlan]
    gemini.score_variant(frames, prompt) -> {visual_coherence, prompt_adherence}
    gemini.identify_entity(crop_path) -> {description, category, attributes}
    gemini.find_entity_in_keyframes(entity, keyframes) -> list[EntityHit]
    runway.generate(clip_path, plan, style_ref=None) -> {url, description}
    elevenlabs.narrate(text) -> bytes

Two modes:
  - USE_AI_STUBS=true  (default) -> route to _stubs.py, no API keys needed
  - USE_AI_STUBS=false          -> adapt Stephen's real modules (Veo + Gemini
                                   + ElevenLabs) to the surface above. note that
                                   `runway.generate` remains the stable adapter
                                   name even though the live video provider is Veo
                                   via `GEMINI_API_KEY`.

Name mapping from real modules:
  gemini.create_edit_plan             -> gemini.plan_variants
  gemini.score_variant                -> gemini.score_variant   (arg order adapted)
  gemini.identify_entity              -> gemini.identify_entity (attr rename)
  gemini.search_keyframes_for_entity  -> gemini.find_entity_in_keyframes
  veo.generate_variant                -> runway.generate
  elevenlabs.generate_narration       -> elevenlabs.narrate    (path -> bytes)
"""
from __future__ import annotations

import types as _types
from pathlib import Path

from ai.services import _stubs
from ai.services.config import get_settings as _get_ai_settings


def _load_backend_stub_mode() -> bool | None:
    try:
        from app.config.settings import get_settings as _get_backend_settings
    except ModuleNotFoundError:
        return None
    return _get_backend_settings().use_ai_stubs


def _resolve_use_ai_stubs() -> bool:
    backend_value = _load_backend_stub_mode()
    if backend_value is not None:
        return backend_value
    return _get_ai_settings().use_ai_stubs


_USE_AI_STUBS = _resolve_use_ai_stubs()


if _USE_AI_STUBS:
    gemini = _stubs.gemini
    runway = _stubs.runway
    elevenlabs = _stubs.elevenlabs
    entity_tracker = _stubs.entity_tracker

else:
    # real impls live in sibling modules; importing them requires GEMINI_API_KEY
    _real_settings = _get_ai_settings()
    if not _real_settings.real_ai_ready:
        raise RuntimeError(
            "USE_AI_STUBS=false requires GEMINI_API_KEY for the live gemini/veo "
            "provider path. leave USE_AI_STUBS=true for local stub mode."
        )

    from app.services import storage
    from ai.services import gemini as _gemini_real
    from ai.services import veo as _veo_real
    from ai.services import elevenlabs as _el_real
    from ai.services import entity_tracker as _et_real

    # ------------------------ gemini adapter ------------------------

    async def _plan_variants(prompt: str, bbox: dict, frame_path: str) -> list[dict]:
        plan = await _gemini_real.create_edit_plan(
            prompt, bbox, frame_path=frame_path
        )
        variants = plan.get("variants") if isinstance(plan, dict) else None
        if not variants:
            return []
        # Stephen's schema uses prompt_for_veo; my stubs/workers use prompt_for_runway.
        # Normalize so downstream code always finds prompt_for_runway, and
        # give every variant a conditioning_strategy default so the worker
        # never has to second-guess a missing field.
        for v in variants:
            v.setdefault("prompt_for_runway", v.get("prompt_for_veo", ""))
            strategy = str(v.get("conditioning_strategy", "")).lower()
            if strategy not in ("first_frame", "text_only"):
                intent = str(v.get("intent", "")).lower()
                # always use first_frame — text_only produces garbage output
                # because veo has no visual context for the scene
                v["conditioning_strategy"] = "first_frame"
        return variants

    async def _score_variant(
        frames: list[str] | None = None,
        prompt: str = "",
        *,
        original_prompt: str | None = None,
        variant_frame_paths: list[str] | None = None,
    ) -> dict:
        # accept both positional (frames, prompt) and keyword (original_prompt, variant_frame_paths) calling conventions
        p = original_prompt or prompt
        f = variant_frame_paths or frames or []
        return await _gemini_real.score_variant(original_prompt=p, variant_frame_paths=f)

    async def _identify_entity(crop_path: str) -> dict:
        result = await _gemini_real.identify_entity(crop_path)
        # rename visual_attributes -> attributes to match the backend's schema
        if isinstance(result, dict) and "visual_attributes" in result:
            result["attributes"] = result.pop("visual_attributes")
        result.setdefault("attributes", {})
        return result

    async def _find_entity_in_keyframes(entity: dict, keyframes: list[str]) -> list[dict]:
        description = entity.get("description", "")
        out: list[dict] = []
        for batch_start in range(0, len(keyframes), 10):
            batch = keyframes[batch_start : batch_start + 10]
            hits = await _gemini_real.search_keyframes_for_entity(description, batch)
            # Stephen returns [{keyframe_index, confidence, found}].
            # Convert to the EntityHit shape the backend expects. Assume 1fps
            # sampling (backend's entity_job sets KEYFRAMES_PER_SECOND=1.0).
            for h in hits:
                if not h.get("found"):
                    continue
                idx = batch_start + int(h.get("keyframe_index", 0))
                out.append({
                    "start_ts": float(idx),
                    "end_ts": float(idx) + 1.0,
                    "keyframe_url": keyframes[idx] if idx < len(keyframes) else "",
                    "confidence": float(h.get("confidence", 0.0)),
                })
        return out

    gemini = _types.SimpleNamespace(
        plan_variants=_plan_variants,
        score_variant=_score_variant,
        identify_entity=_identify_entity,
        find_entity_in_keyframes=_find_entity_in_keyframes,
    )

    # ------------------------ runway (veo) adapter ------------------------

    async def _runway_generate(
        clip_path: str,
        plan: dict,
        style_ref: str | None = None,
        frame_path: str | None = None,
        on_tick=None,
    ) -> dict:
        """Drive one Veo generation.

        ``clip_path`` is the source MP4 slice — we do NOT pass it to Veo
        (Veo's image conditioning slot expects a still frame, and handing
        it an mp4 silently skips conditioning, which is why earlier
        variants looked identical to the source).

        ``frame_path`` is a still image (png/jpg) that Veo uses as the
        opening frame. Callers should pass the FULL reference keyframe
        (not a cropped bbox), otherwise Veo will generate a video of
        just the cropped region instead of the whole scene. The bbox
        region is expressed through the Gemini-authored prose prompt.
        Pass ``None`` to skip image conditioning entirely (useful for
        'remove/replace' intents where the opening frame would anchor
        the subject Veo is supposed to regenerate).
        """
        prompt_text = plan.get("prompt_for_runway") or plan.get("prompt_for_veo") or plan.get("description", "")
        conditioning = frame_path or style_ref
        if style_ref:
            out_path = await _veo_real.generate_propagation_variant(
                prompt_for_veo=prompt_text,
                style_reference_path=style_ref,
                reference_frame_path=frame_path,
            )
        else:
            out_path = await _veo_real.generate_variant(
                prompt_for_veo=prompt_text,
                reference_frame_path=conditioning,
                on_tick=on_tick,
            )
        published_url = await storage.publish(Path(out_path), content_type="video/mp4")
        return {
            "url": published_url,
            "description": plan.get("description", ""),
        }

    runway = _types.SimpleNamespace(generate=_runway_generate)

    # ------------------------ elevenlabs adapter ------------------------

    async def _narrate(text: str) -> bytes:
        mp3_path = await _el_real.generate_narration(text)
        return Path(mp3_path).read_bytes()

    elevenlabs = _types.SimpleNamespace(narrate=_narrate)

    # Stephen's entity_tracker is higher-level orchestration; expose as-is for
    # anyone who wants to bypass the backend worker and use his flow directly.
    entity_tracker = _et_real
