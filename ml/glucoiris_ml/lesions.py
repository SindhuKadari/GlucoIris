"""Lesion masks → connected components → bounding boxes on the original image."""
from __future__ import annotations

import cv2
import numpy as np

from .models import LESION_CLASSES

LESION_LABEL = {
    "microaneurysms": "Microaneurysm",
    "haemorrhages": "Haemorrhage",
    "hard_exudates": "Hard exudate",
    "soft_exudates": "Soft exudate",
}
LESION_COLOR = {  # RGB; distinct in hue AND lightness, readable on fundus orange
    "microaneurysms": (255, 64, 160),
    "haemorrhages": (64, 224, 255),
    "hard_exudates": (255, 235, 59),
    "soft_exudates": (140, 255, 120),
}
# Minimum component area (original pixels, at ~4000px width) to report a box.
MIN_AREA = {"microaneurysms": 6, "haemorrhages": 40, "hard_exudates": 25, "soft_exudates": 80}


def boxes_from_probs(probs: dict[str, np.ndarray], thresholds: dict[str, float], scale_ref: int = 4288) -> list[dict]:
    """`probs[c]` are HxW probability maps in original-image coordinates."""
    boxes = []
    for c in LESION_CLASSES:
        p = probs.get(c)
        if p is None:
            continue
        h, w = p.shape
        s = w / scale_ref
        mask = (p >= thresholds.get(c, 0.5)).astype(np.uint8)
        # Group nearby fragments (e.g. exudate clusters) before boxing.
        k = max(1, int(round((9 if c != "microaneurysms" else 5) * s)))
        grouped = cv2.dilate(mask, np.ones((k, k), np.uint8))
        n, lbl, stats, _ = cv2.connectedComponentsWithStats(grouped, 8)
        min_area = max(2, MIN_AREA[c] * s * s)
        max_area = 0.05 * h * w  # a single "lesion" covering >5% of the frame is not plausible
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            comp = (lbl == i) & (mask > 0)
            if comp.sum() < min_area or comp.sum() > max_area:
                continue
            boxes.append({
                "class": c,
                "label": LESION_LABEL[c],
                "x": int(x), "y": int(y), "w": int(bw), "h": int(bh),
                "area_px": int(comp.sum()),
                "score": float(p[comp].mean()),
            })
    boxes.sort(key=lambda b: -b["score"])
    return boxes


def colour_mask(probs: dict[str, np.ndarray], thresholds: dict[str, float]) -> np.ndarray:
    """RGBA overlay: each lesion class in its colour, transparent elsewhere."""
    any_p = next(iter(probs.values()))
    h, w = any_p.shape
    rgba = np.zeros((h, w, 4), np.uint8)
    for c in LESION_CLASSES:
        p = probs.get(c)
        if p is None:
            continue
        m = p >= thresholds.get(c, 0.5)
        rgba[m, :3] = LESION_COLOR[c]
        rgba[m, 3] = 255
    return rgba


def draw_boxes(rgb: np.ndarray, boxes: list[dict], max_boxes: int = 200) -> np.ndarray:
    """Final annotated image: bounding boxes with class labels on the original."""
    out = rgb.copy()
    h, w = out.shape[:2]
    t = max(2, int(round(w / 900)))
    for b in boxes[:max_boxes]:
        col = LESION_COLOR[b["class"]]
        pad = max(2, int(w / 400))
        x0, y0 = max(0, b["x"] - pad), max(0, b["y"] - pad)
        x1, y1 = min(w - 1, b["x"] + b["w"] + pad), min(h - 1, b["y"] + b["h"] + pad)
        cv2.rectangle(out, (x0, y0), (x1, y1), col, t)
    return out
