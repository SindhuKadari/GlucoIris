"""GlucoIris inference service (FastAPI).

Research prototype: serves the quality screen and whichever trained models are
present in ml/weights/. Missing models are reported as unavailable — never
replaced with simulated output.

Run (repo root):
    python -m uvicorn backend.app.main:app --port 8000
"""
from __future__ import annotations

import os
import sys
import threading
import uuid

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "ml"))
from glucoiris_ml.inference import GlucoIrisPipeline  # noqa: E402

WEIGHTS = os.environ.get("GLUCOIRIS_WEIGHTS", os.path.join(ROOT, "ml", "weights"))
ARTIFACTS = os.environ.get("GLUCOIRIS_ARTIFACTS", os.path.join(ROOT, "backend", "artifacts"))
ALLOW_SMOKE = os.environ.get("GLUCOIRIS_ALLOW_SMOKE") == "1"
MAX_BYTES = 20 * 1024 * 1024
os.makedirs(ARTIFACTS, exist_ok=True)

app = FastAPI(title="GlucoIris inference service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("GLUCOIRIS_CORS", "http://localhost:5173,http://localhost:5174").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/artifacts", StaticFiles(directory=ARTIFACTS), name="artifacts")

pipeline = GlucoIrisPipeline(WEIGHTS, allow_smoke=ALLOW_SMOKE)
lock = threading.Lock()  # one inference at a time on CPU


async def _read_image(file: UploadFile) -> np.ndarray:
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(415, f"Unsupported type {file.content_type}; use JPEG or PNG.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image larger than 20 MB.")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(422, "File could not be decoded as an image.")
    if min(img.shape[:2]) < 256:
        raise HTTPException(422, "Image is too small to assess (short side < 256 px).")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def _save_png(rgba: np.ndarray, kind: str) -> str:
    name = f"{uuid.uuid4().hex}_{kind}.png"
    cv2.imwrite(os.path.join(ARTIFACTS, name), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    return f"/artifacts/{name}"


def _save_jpg(rgb: np.ndarray, kind: str) -> str:
    name = f"{uuid.uuid4().hex}_{kind}.jpg"
    cv2.imwrite(os.path.join(ARTIFACTS, name), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 88])
    return f"/artifacts/{name}"


@app.get("/v1/health")
def health():
    return {"service": "glucoiris-inference", "version": app.version, "allow_smoke_weights": ALLOW_SMOKE, "modules": pipeline.status()}


@app.post("/v1/quality")
async def quality(file: UploadFile = File(...)):
    rgb = await _read_image(file)
    with lock:
        return pipeline.quality(rgb)


@app.post("/v1/analyze")
async def analyze(file: UploadFile = File(...), quality_gate: bool = Query(True)):
    rgb = await _read_image(file)
    with lock:
        res = pipeline.analyze(rgb, run_quality_gate=quality_gate)
    arts: dict = {}
    w, h = res["image"]["artifact_width"], res["image"]["artifact_height"]
    if "gradcam_b4_rgba" in res:
        arts["gradcam_b4"] = {"url": _save_png(res.pop("gradcam_b4_rgba"), "gradcam_b4"), "width": w, "height": h}
    if "gradcam_b4_blend_rgb" in res:
        arts["gradcam_b4_blend"] = {"url": _save_jpg(res.pop("gradcam_b4_blend_rgb"), "gradcam_b4_blend"), "width": w, "height": h}
    if "gradcam_b4_boxes_rgb" in res:
        arts["gradcam_b4_boxes"] = {"url": _save_jpg(res.pop("gradcam_b4_boxes_rgb"), "gradcam_b4_boxes"), "width": w, "height": h}
    if "attribution_rgba" in res:
        arts["attribution"] = {"url": _save_png(res.pop("attribution_rgba"), "gradcam"), "width": w, "height": h}
    if "attribution_blend_rgb" in res:
        arts["attribution_blend"] = {"url": _save_jpg(res.pop("attribution_blend_rgb"), "gradcam_vit_blend"), "width": w, "height": h}
    if "attribution_boxes_rgb" in res:
        arts["attribution_boxes"] = {"url": _save_jpg(res.pop("attribution_boxes_rgb"), "gradcam_vit_boxes"), "width": w, "height": h}
    if "vessels_rgba" in res:
        arts["vessels"] = {"url": _save_png(res.pop("vessels_rgba"), "vessels"), "width": w, "height": h}
    if "lesions_rgba" in res:
        arts["lesions"] = {"url": _save_png(res.pop("lesions_rgba"), "lesions"), "width": w, "height": h}
    if "boxes_jpeg_rgb" in res:
        arts["boxes_image"] = {"url": _save_jpg(res.pop("boxes_jpeg_rgb"), "boxes"), "width": w, "height": h}
    res["artifacts"] = arts
    res["service_version"] = app.version
    return res
