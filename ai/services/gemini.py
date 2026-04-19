"""Gemini service — the creative director of iris.

Handles 5 distinct uses of the Gemini API:
1. Prompt structuring (raw prompt -> structured edit plan with 3 variants)
2. Entity identification (bbox crop -> entity description)
3. Entity search (keyframe batch -> which frames contain the entity)
4. Quality scoring (generated clip frames -> visual_coherence + prompt_adherence)
5. Narration script generation (variant description -> cinematic voiceover text)
"""

import json
from pathlib import Path

from google import genai
from google.genai import types

from ai.services.config import get_settings
from ai.services.logger import tracked

# Load prompt templates
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.txt").read_text()


# ``Part.from_uri`` only accepts HTTPS / gs:// / File API URIs — handing it a
# local filesystem path makes Gemini return 400 INVALID_ARGUMENT ("Unsupported
# file URI type"), which was silently firing on every bbox draw + every
# scoring pass. This helper DTRT:
#   • HTTPS / gs:// / File API URI  → ``Part.from_uri`` (Gemini fetches it)
#   • anything else (local path)     → read bytes, ``Part.from_bytes``
def _image_part_from_path(path: str) -> types.Part:
    low = path.lower()
    if low.startswith(("http://", "https://", "gs://")) or low.startswith(
        "https://generativelanguage.googleapis.com/files/"
    ):
        # guess mime from the url's path component; query-string signatures
        # don't affect the suffix we care about.
        url_path = path.split("?", 1)[0].lower()
        if url_path.endswith(".png"):
            mime = "image/png"
        elif url_path.endswith(".webp"):
            mime = "image/webp"
        else:
            mime = "image/jpeg"
        return types.Part.from_uri(file_uri=path, mime_type=mime)

    p = Path(path)
    ext = p.suffix.lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "image/png")
    return types.Part.from_bytes(data=p.read_bytes(), mime_type=mime)


def get_client() -> genai.Client:
    settings = get_settings()
    settings.require_real_ai(provider="gemini")
    return genai.Client(api_key=settings.gemini_api_key)


@tracked("gemini", "edit_plan")
async def create_edit_plan(
    prompt: str,
    bbox: dict[str, float],
    entity_description: str | None = None,
    frame_path: str | None = None,
) -> dict:
    """Convert a raw user prompt into a structured edit plan with 3 variants.

    We ship the actual reference frame to Gemini-2.5-Pro (vision) so the
    plan is grounded in what's really on screen instead of hallucinating
    context. Without this, Gemini tends to emit generic imperative
    prompts like "remove X, fill background" — phrasing that Veo 3.1
    ignores because Veo is a text-to-video / first-frame-conditioned
    model, not an inpainter. The resulting plan must be a Veo-optimised
    *scene description* (what the user wants to see), with a
    conditioning_strategy that tells the worker whether to hand Veo the
    original frame at all.

    Args:
        prompt: Raw user prompt (e.g., "make this car red")
        bbox: Normalized bounding box {x, y, w, h} (0-1, top-left origin)
        entity_description: Optional description of the entity in the bbox
        frame_path: Optional path to the reference frame (jpg/png)

    Returns:
        Structured edit plan with 1-3 variants, each containing:
        description, tone, color_grading, region_emphasis,
        prompt_for_veo, conditioning_strategy, intent.
    """
    client = get_client()

    system_prompt = _load_prompt("edit_plan")
    user_payload = {
        "user_prompt": prompt,
        "bbox": bbox,
        "entity_description": entity_description,
        "bbox_is_full_frame": (
            bbox.get("w", 0) >= 0.98 and bbox.get("h", 0) >= 0.98
        ),
    }

    parts: list = [json.dumps(user_payload)]
    if frame_path:
        frame_file = Path(frame_path)
        if frame_file.exists():
            ext = frame_file.suffix.lower()
            mime = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
            }.get(ext, "image/jpeg")
            parts.append(
                types.Part.from_bytes(
                    data=frame_file.read_bytes(),
                    mime_type=mime,
                )
            )

    response = client.models.generate_content(
        model="gemini-2.5-pro",
        contents=parts,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
        ),
    )

    return json.loads(response.text)


@tracked("gemini", "identify_entity")
async def identify_entity(
    reference_crop_path: str,
) -> dict[str, str]:
    """Identify what an entity is from a cropped reference frame.

    Args:
        reference_crop_path: Path to the cropped image from the bbox region

    Returns:
        {"description": str, "category": str, "visual_attributes": str}
    """
    client = get_client()

    image = _image_part_from_path(reference_crop_path)

    system_prompt = _load_prompt("entity_identify")

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[system_prompt, image],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )

    return json.loads(response.text)


@tracked("gemini", "search_keyframes")
async def search_keyframes_for_entity(
    entity_description: str,
    keyframe_paths: list[str],
) -> list[dict]:
    """Search a batch of keyframes for an entity.

    Processes up to 10 keyframes per batch call. Caller should batch externally.

    Args:
        entity_description: Description of the entity to find
        keyframe_paths: List of paths to keyframe images (max 10)

    Returns:
        List of {"keyframe_index": int, "confidence": float, "found": bool}
    """
    client = get_client()

    system_prompt = _load_prompt("entity_search")

    parts: list[types.Part] = [types.Part.from_text(
        text=f"Find this entity in the following keyframes: {entity_description}"
    )]
    for path in keyframe_paths[:10]:
        parts.append(_image_part_from_path(path))

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=parts,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
        ),
    )

    return json.loads(response.text)


@tracked("gemini", "score_variant")
async def score_variant(
    original_prompt: str,
    variant_frame_paths: list[str],
) -> dict[str, int]:
    """Score a generated variant on visual coherence and prompt adherence.

    Args:
        original_prompt: The user's original edit prompt
        variant_frame_paths: 3 sampled frames from the generated clip

    Returns:
        {"visual_coherence": int (1-10), "prompt_adherence": int (1-10)}
    """
    client = get_client()

    system_prompt = _load_prompt("quality_score")

    parts: list[types.Part] = [types.Part.from_text(
        text=f"Original prompt: {original_prompt}"
    )]
    for path in variant_frame_paths:
        parts.append(_image_part_from_path(path))

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=parts,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
        ),
    )

    return json.loads(response.text)


@tracked("gemini", "narration_script")
async def generate_narration_script(
    variant_description: str,
    original_prompt: str,
) -> str:
    """Generate a short cinematic narration script for the before/after reveal.

    Args:
        variant_description: Description of the transformation
        original_prompt: The user's original edit prompt

    Returns:
        Short narration script (1-2 sentences, voiceover style)
    """
    client = get_client()

    system_prompt = _load_prompt("narration")

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=f"Variant: {variant_description}\nOriginal prompt: {original_prompt}",
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
        ),
    )

    return response.text
