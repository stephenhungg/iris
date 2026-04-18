"""SAM (Segment Anything) service — runs on Vultr GPU.

Converts rough bounding boxes into precise segmentation masks.
This is what makes the bbox a real technical input, not UX theater.
"""

import httpx
import base64
from pathlib import Path

from ai.services.config import get_settings

# GPU worker endpoint (Vultr GPU instance)
GPU_WORKER_URL_ENV = "GPU_WORKER_URL"


def _get_gpu_url() -> str:
    settings = get_settings()
    return settings.gpu_worker_url


async def bbox_to_mask(
    frame_path: str,
    bbox: dict[str, float],
) -> str:
    """Send a frame + bbox to the GPU worker and get back a precise segmentation mask.

    The GPU worker runs SAM2 and returns a binary mask PNG.

    Args:
        frame_path: Path to the full video frame
        bbox: Normalized bounding box {x, y, w, h} (0-1, top-left origin)

    Returns:
        Path to the generated mask image (PNG, white = foreground)
    """
    gpu_url = _get_gpu_url()

    frame_bytes = Path(frame_path).read_bytes()
    frame_b64 = base64.b64encode(frame_bytes).decode()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{gpu_url}/sam/segment",
            json={
                "image_b64": frame_b64,
                "bbox": bbox,
            },
        )
        response.raise_for_status()
        data = response.json()

    # Save mask
    mask_bytes = base64.b64decode(data["mask_b64"])
    mask_path = str(Path(frame_path).with_suffix(".mask.png"))
    Path(mask_path).write_bytes(mask_bytes)

    return mask_path


async def is_available() -> bool:
    """Check if the GPU worker is reachable."""
    try:
        gpu_url = _get_gpu_url()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{gpu_url}/health")
            return resp.status_code == 200
    except Exception:
        return False
