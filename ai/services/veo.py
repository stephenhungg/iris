"""Veo service — video generation through the Gemini API.

Uses Veo 3.1 for all video generation:
- Text-to-video (with structured edit plan from Gemini)
- Image-conditioned generation (reference frame from bbox crop)
- Propagation (style-referenced generation for entity continuity)
"""

import time
import asyncio
from pathlib import Path
from typing import Awaitable, Callable

from google import genai
from google.genai import types

from ai.services.config import get_settings
from ai.services.logger import tracked

TickCallback = Callable[[dict], Awaitable[None] | None]

# Veo 3.1 constraints
MIN_DURATION = 4  # seconds
MAX_DURATION = 8
SUPPORTED_DURATIONS = ["4", "6", "8"]
GENERATION_TIMEOUT = 360  # 6 minutes max


def _maybe_await(result):
    """Schedule awaitables returned by a tick callback without blocking veo's loop."""
    if asyncio.iscoroutine(result):
        try:
            asyncio.get_event_loop().create_task(result)
        except RuntimeError:
            pass


def get_client() -> genai.Client:
    settings = get_settings()
    settings.require_real_ai(provider="veo")
    return genai.Client(api_key=settings.gemini_api_key)


@tracked("veo", "generate_variant")
async def generate_variant(
    prompt_for_veo: str,
    reference_frame_path: str | None = None,
    duration: int = 4,
    aspect_ratio: str = "16:9",
    on_tick: TickCallback | None = None,
) -> str:
    """Generate a single video variant using Veo 3.1.

    Args:
        prompt_for_veo: Structured prompt from Gemini edit plan
        reference_frame_path: Optional path to reference frame (image conditioning).
            For bbox spatial grounding, pass the cropped bbox region as the reference.
        duration: Duration in seconds (4, 6, or 8)
        aspect_ratio: "16:9" or "9:16"

    Returns:
        Path to the generated video file
    """
    client = get_client()

    duration_str = str(min(max(duration, MIN_DURATION), MAX_DURATION))
    if duration_str not in SUPPORTED_DURATIONS:
        duration_str = "4"

    config = types.GenerateVideosConfig(
        aspect_ratio=aspect_ratio,
        duration_seconds=duration_str,
        number_of_videos=1,
    )

    kwargs: dict = {
        "model": "veo-3.1-generate-preview",
        "prompt": prompt_for_veo,
        "config": config,
    }

    # Image conditioning: use the reference frame as the starting frame.
    # Veo expects a still image here — if something else slips through
    # (e.g. an mp4 slice) we refuse it rather than silently uploading
    # bytes that Veo will ignore, which was the "identical-output" bug.
    if reference_frame_path:
        ext = Path(reference_frame_path).suffix.lower()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }
        mime = mime_map.get(ext)
        if mime is None:
            raise ValueError(
                f"reference_frame_path must be a still image (png/jpg/webp), got: {reference_frame_path}"
            )
        kwargs["image"] = types.Image(
            image_bytes=Path(reference_frame_path).read_bytes(),
            mime_type=mime,
        )

    operation = client.models.generate_videos(**kwargs)
    if on_tick is not None:
        _maybe_await(on_tick({
            "kind": "veo.submit",
            "op": getattr(operation, "name", None),
            "prompt": prompt_for_veo,
            "duration": duration_str,
            "aspect_ratio": aspect_ratio,
            "conditioned": reference_frame_path is not None,
        }))

    # Poll for completion
    elapsed = 0
    while not operation.done:
        await asyncio.sleep(10)
        elapsed += 10
        if elapsed > GENERATION_TIMEOUT:
            raise TimeoutError(
                f"Veo generation timed out after {GENERATION_TIMEOUT}s"
            )
        operation = client.operations.get(operation)
        # only emit the heartbeat while the op is still in flight — the
        # "done" transition is conveyed by the subsequent veo_done event
        # so we don't confuse the thought-process console with a double
        # success/failure ordering.
        if on_tick is not None and not operation.done:
            _maybe_await(on_tick({
                "kind": "veo.poll",
                "elapsed": elapsed,
                "done": False,
            }))

    # Download the generated video. The google-genai SDK dropped the
    # `Video.name` attribute in recent versions, so we derive a stable
    # filename from the operation id instead of trusting the Video object.
    generated_video = operation.response.generated_videos[0]
    video_obj = generated_video.video

    op_name = getattr(operation, "name", "") or ""
    op_id = op_name.rsplit("/", 1)[-1] if op_name else ""
    filename_stem = op_id or f"veo_{int(time.time() * 1000)}"

    output_path = Path(get_settings().storage_path) / "generated" / f"{filename_stem}.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Newer SDK: download() populates video_obj.video_bytes; save() writes to disk.
    # Older SDK: save() alone pulls bytes + writes. Try the modern path first,
    # fall back to the legacy flow if either step is unavailable.
    try:
        client.files.download(file=video_obj)
    except Exception:
        # some SDK builds require calling save() directly without prior download
        pass

    try:
        video_obj.save(str(output_path))
    except Exception:
        # last-resort fallback: write raw bytes if the SDK exposes them.
        video_bytes = getattr(video_obj, "video_bytes", None)
        if not video_bytes:
            raise
        output_path.write_bytes(video_bytes)

    return str(output_path)


async def generate_variants_parallel(
    variant_prompts: list[str],
    reference_frame_path: str | None = None,
    duration: int = 4,
    aspect_ratio: str = "16:9",
) -> list[dict[str, str | None]]:
    """Fan-out: generate 3 variants in parallel.

    Returns results progressively — each variant resolves independently.
    If a variant fails, its entry has error set instead of path.

    Args:
        variant_prompts: List of 3 structured prompts from the edit plan
        reference_frame_path: Optional reference frame for image conditioning
        duration: Duration in seconds
        aspect_ratio: Aspect ratio

    Returns:
        List of {"path": str | None, "error": str | None} for each variant
    """
    tasks = [
        generate_variant(prompt, reference_frame_path, duration, aspect_ratio)
        for prompt in variant_prompts
    ]

    results: list[dict[str, str | None]] = []
    for coro in asyncio.as_completed(tasks):
        try:
            path = await coro
            results.append({"path": path, "error": None})
        except Exception as e:
            results.append({"path": None, "error": str(e)})

    return results


async def generate_propagation_variant(
    prompt_for_veo: str,
    style_reference_path: str,
    reference_frame_path: str | None = None,
    duration: int = 4,
    aspect_ratio: str = "16:9",
) -> str:
    """Generate a single propagation variant with style reference for consistency.

    Uses the accepted variant's frame as style conditioning to maintain
    visual continuity across segments.

    Args:
        prompt_for_veo: Structured prompt for this segment
        style_reference_path: Frame from the accepted variant (for consistency)
        reference_frame_path: Optional reference frame from the target segment
        duration: Duration in seconds
        aspect_ratio: Aspect ratio

    Returns:
        Path to the generated video file
    """
    # For propagation, we use the style reference as the image conditioning
    # This ensures the generated clip matches the look of the accepted variant
    return await generate_variant(
        prompt_for_veo=prompt_for_veo,
        reference_frame_path=style_reference_path,
        duration=duration,
        aspect_ratio=aspect_ratio,
    )
