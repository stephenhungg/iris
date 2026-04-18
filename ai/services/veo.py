"""Veo service — video generation through the Gemini API.

Uses Veo 3.1 for all video generation:
- Text-to-video (with structured edit plan from Gemini)
- Image-conditioned generation (reference frame from bbox crop)
- Propagation (style-referenced generation for entity continuity)
"""

import time
import asyncio
from pathlib import Path

from google import genai
from google.genai import types

from ai.services.config import get_settings
from ai.services.logger import tracked

# Veo 3.1 constraints
MIN_DURATION = 4  # seconds
MAX_DURATION = 8
SUPPORTED_DURATIONS = ["4", "6", "8"]
GENERATION_TIMEOUT = 360  # 6 minutes max


def get_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(api_key=settings.gemini_api_key)


@tracked("veo", "generate_variant")
async def generate_variant(
    prompt_for_veo: str,
    reference_frame_path: str | None = None,
    duration: int = 4,
    aspect_ratio: str = "16:9",
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

    # Image conditioning: use the reference frame to guide generation
    if reference_frame_path:
        ref_image = types.Image.from_file(reference_frame_path)
        kwargs["image"] = ref_image

    operation = client.models.generate_videos(**kwargs)

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

    # Download the generated video
    generated_video = operation.response.generated_videos[0]
    client.files.download(file=generated_video.video)

    output_path = Path(get_settings().storage_path) / "generated" / f"{generated_video.video.name}.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    generated_video.video.save(str(output_path))

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
