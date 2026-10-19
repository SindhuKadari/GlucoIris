"""Bounding boxes around the Grad-CAM regions that drove a prediction.

Works on any Grad-CAM heatmap (EfficientNet-B4 `features[-1]` or the ViT's last block)
that is already in the ORIGINAL image frame and min–max normalised to [0, 1]:

  1. keep pixels inside the retinal field whose heat is >= `rel_threshold` × the peak;
  2. close small gaps, then take 8-connected components;
  3. drop components smaller than `min_area_frac` of the image;
  4. rank by share of total heat ("CAM mass") and keep the top `max_regions`.

Boxes are returned normalised to the image size (x, y, w, h in 0–1), so they align with
any rendering of the same frame. They mark where the model's evidence is concentrated —
they are NOT verified lesions.
"""
from __future__ import annotations

import cv2
import numpy as np

BOX_COLOR = (255, 255, 255)  # white box with a dark outline reads on any jet colour


def cam_regions(heat: np.ndarray, fov: np.ndarray | None = None, rel_threshold: float = 0.5,
                min_area_frac: float = 0.003, max_regions: int = 5) -> list[dict]:
    H, W = heat.shape
    h = heat.astype(np.float32)
    if fov is not None:
        h = h * (fov > 0)
    peak = float(h.max())
    if peak <= 0:
        return []
    mask = (h >= rel_threshold * peak).astype(np.uint8)
    k = max(3, int(round(min(H, W) / 120)) | 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    total = float(h[mask > 0].sum()) or 1.0
    regions = []
    for i in range(1, n):
        x, y, w, hh, area = (int(v) for v in stats[i])
        if area < min_area_frac * H * W:
            continue
        vals = h[labels == i]
        regions.append({
            "x": x / W, "y": y / H, "w": w / W, "h": hh / H,
            "peak": round(float(vals.max()), 4),
            "mean": round(float(vals.mean()), 4),
            "share": round(float(vals.sum()) / total, 4),
        })
    regions.sort(key=lambda r: r["share"], reverse=True)
    regions = regions[:max_regions]
    for rank, r in enumerate(regions, 1):
        r["rank"] = rank
    return regions


def draw_cam_boxes(rgb: np.ndarray, regions: list[dict]) -> np.ndarray:
    """Draw ranked boxes (#1 = most heat) on an RGB image of any size."""
    out = rgb.copy()
    H, W = out.shape[:2]
    t = max(2, round(W / 450))
    fs = max(0.5, W / 1500)
    for r in regions:
        x0, y0 = int(r["x"] * W), int(r["y"] * H)
        x1, y1 = int((r["x"] + r["w"]) * W), int((r["y"] + r["h"]) * H)
        cv2.rectangle(out, (x0, y0), (x1, y1), (0, 0, 0), t + 2, cv2.LINE_AA)
        cv2.rectangle(out, (x0, y0), (x1, y1), BOX_COLOR, t, cv2.LINE_AA)
        label = f"#{r['rank']}"
        org = (x0 + t + 2, max(y0 - t - 4, int(18 * fs)))
        cv2.putText(out, label, org, cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 0, 0), t + 2, cv2.LINE_AA)
        cv2.putText(out, label, org, cv2.FONT_HERSHEY_SIMPLEX, fs, BOX_COLOR, t, cv2.LINE_AA)
    return out
