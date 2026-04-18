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
                                   + ElevenLabs) to the surface above

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

from app.config.settings import get_settings
from app.services import storage
from ai.services import _stubs

_settings = get_settings()


if _settings.use_ai_stubs:
    gemini = _stubs.gemini
    runway = _stubs.runway
    elevenlabs = _stubs.elevenlabs
    entity_tracker = _stubs.entity_tracker

else:
    # real impls live in sibling modules; importing them requires GEMINI_API_KEY
    from ai.services import gemini as _gemini_real
    from ai.services import veo as _veo_real
    from ai.services import elevenlabs as _el_real
    from ai.services import entity_tracker as _et_real

    # ------------------------ gemini adapter ------------------------

    async def _plan_variants(prompt: str, bbox: dict, frame_path: str) -> list[dict]:
        plan = await _gemini_real.create_edit_plan(prompt, bbox)
        variants = plan.get("variants") if isinstance(plan, dict) else None
        if not variants:
            return []
        # Stephen's schema uses prompt_for_veo; my stubs/workers use prompt_for_runway.
        # Normalize so downstream code always finds prompt_for_runway.
        for v in variants:
            v.setdefault("prompt_for_runway", v.get("prompt_for_veo", ""))
        return variants

    async def _score_variant(frames: list[str], prompt: str) -> dict:
        return await _gemini_real.score_variant(prompt, frames)

    async def _identify_entity(crop_path: str) -> dict:
        result = await _gemini_real.identify_entity(crop_path)
        # rename visual_attributes -> attributes to match the backend's schema
        if isinstance(result, dict) and "visual_attributes" in result:
            result["attributes"] = result.pop("visual_attributes")
        result.setdefault("attributes", {})
        return result

    async def _find_entity_in_keyframes(entity: dict, keyframes: list[str]) -> list[dict]:
        description = entity.get("description", "")
        hits = await _gemini_real.search_keyframes_for_entity(description, keyframes)
        # Stephen returns [{keyframe_index, confidence, found}].
        # Convert to the EntityHit shape the backend expects. Assume 1fps sampling
        # (backend's entity_job sets KEYFRAMES_PER_SECOND=1.0).
        out: list[dict] = []
        for h in hits:
            if not h.get("found"):
                continue
            idx = int(h.get("keyframe_index", 0))
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
    ) -> dict:
        prompt_text = plan.get("prompt_for_runway") or plan.get("prompt_for_veo") or plan.get("description", "")
        if style_ref:
            out_path = await _veo_real.generate_propagation_variant(
                prompt_for_veo=prompt_text,
                style_reference_path=style_ref,
            )
        else:
            out_path = await _veo_real.generate_variant(
                prompt_for_veo=prompt_text,
                reference_frame_path=clip_path,  # passes first-frame crop for spatial conditioning
            )
        return {
            "url": storage.url_for_path(Path(out_path)),
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
