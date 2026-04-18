"""GPU Worker — runs on Vultr GPU instance.

Serves SAM2 segmentation and CLIP embeddings over HTTP.
The main backend calls this service for GPU-accelerated tasks.
"""

import base64
import io

import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI

app = FastAPI(title="iris-gpu-worker")

# ---------- lazy model loading ----------

_sam_model = None
_clip_model = None
_clip_preprocess = None


def get_sam():
    global _sam_model
    if _sam_model is None:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        checkpoint = "./checkpoints/sam2.1_hiera_small.pt"
        config = "configs/sam2.1/sam2.1_hiera_s.yaml"
        _sam_model = SAM2ImagePredictor(build_sam2(config, checkpoint))
    return _sam_model


def get_clip():
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        import open_clip

        _clip_model, _, _clip_preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="laion2b_s34b_b79k"
        )
        _clip_model.eval()
        if torch.cuda.is_available():
            _clip_model = _clip_model.cuda()
    return _clip_model, _clip_preprocess


# ---------- helpers ----------

def b64_to_image(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def mask_to_b64(mask: np.ndarray) -> str:
    img = Image.fromarray((mask * 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# ---------- endpoints ----------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "gpu": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    }


@app.post("/sam/segment")
async def sam_segment(data: dict):
    """Segment an entity from a frame using a bounding box prompt.

    Input: {"image_b64": str, "bbox": {"x": float, "y": float, "w": float, "h": float}}
    Output: {"mask_b64": str}
    """
    image = b64_to_image(data["image_b64"])
    bbox = data["bbox"]
    w, h = image.size

    # convert normalized bbox to pixel coords [x1, y1, x2, y2]
    box = np.array([
        bbox["x"] * w,
        bbox["y"] * h,
        (bbox["x"] + bbox["w"]) * w,
        (bbox["y"] + bbox["h"]) * h,
    ])

    predictor = get_sam()
    predictor.set_image(np.array(image))
    masks, scores, _ = predictor.predict(box=box, multimask_output=False)

    best_mask = masks[0]  # shape: (H, W), bool
    return {"mask_b64": mask_to_b64(best_mask)}


@app.post("/clip/embed")
async def clip_embed(data: dict):
    """Get CLIP embedding for a single image.

    Input: {"image_b64": str}
    Output: {"embedding": list[float]}
    """
    model, preprocess = get_clip()
    image = b64_to_image(data["image_b64"])
    tensor = preprocess(image).unsqueeze(0)
    if torch.cuda.is_available():
        tensor = tensor.cuda()

    with torch.no_grad():
        embedding = model.encode_image(tensor)
        embedding = embedding / embedding.norm(dim=-1, keepdim=True)

    return {"embedding": embedding[0].cpu().tolist()}


@app.post("/clip/batch-embed")
async def clip_batch_embed(data: dict):
    """Get CLIP embeddings for a batch of images.

    Input: {"images_b64": list[str]}
    Output: {"embeddings": list[list[float]]}
    """
    model, preprocess = get_clip()
    images = [b64_to_image(b64) for b64 in data["images_b64"]]
    tensors = torch.stack([preprocess(img) for img in images])
    if torch.cuda.is_available():
        tensors = tensors.cuda()

    with torch.no_grad():
        embeddings = model.encode_image(tensors)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)

    return {"embeddings": embeddings.cpu().tolist()}
