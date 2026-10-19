"""Fundus preprocessing shared by training and inference.

Every transform records how the model input maps back to the original image so
heatmaps, masks and boxes can be drawn on the source pixels (spec §8: overlay
alignment is a product requirement).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import cv2
import numpy as np


@dataclass
class CropInfo:
    """Square crop around the retinal disc, in original-image pixels."""

    x0: int
    y0: int
    side: int  # side of the square crop (may extend past the image; padded with black)
    orig_w: int
    orig_h: int

    def to_dict(self) -> dict:
        return asdict(self)


def fov_mask(rgb: np.ndarray, thresh: int = 20) -> np.ndarray:
    """Binary field-of-view mask: the illuminated retinal disc."""
    red = rgb[..., 0]
    mask = (red > thresh).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return mask


def crop_to_fundus(rgb: np.ndarray) -> tuple[np.ndarray, CropInfo]:
    """Square-crop the fundus disc (centred), padding with black where needed."""
    h, w = rgb.shape[:2]
    m = fov_mask(rgb)
    ys, xs = np.nonzero(m)
    if len(xs) < 0.02 * h * w:  # no recognisable disc: centre square
        side = max(h, w)
        cx, cy = w // 2, h // 2
    else:
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        side = int(max(x1 - x0, y1 - y0) * 1.02) + 1
    x0, y0 = cx - side // 2, cy - side // 2
    canvas = np.zeros((side, side, 3), dtype=rgb.dtype)
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
    canvas[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = rgb[sy0:sy1, sx0:sx1]
    return canvas, CropInfo(int(x0), int(y0), int(side), int(w), int(h))


def ben_graham(rgb: np.ndarray, sigma_frac: float = 1 / 30) -> np.ndarray:
    """Local-average colour subtraction (Graham, Kaggle DR 2015) inside the disc."""
    side = rgb.shape[0]
    blur = cv2.GaussianBlur(rgb, (0, 0), side * sigma_frac)
    out = cv2.addWeighted(rgb, 4, blur, -4, 128)
    disc = np.zeros(rgb.shape[:2], np.uint8)
    cv2.circle(disc, (side // 2, side // 2), int(side * 0.48), 1, -1)
    return (out * disc[..., None]).astype(np.uint8)


def classifier_input(rgb: np.ndarray, size: int = 224) -> tuple[np.ndarray, CropInfo]:
    """RGB uint8 → square crop → Ben Graham → resized (size×size) uint8."""
    crop, info = crop_to_fundus(rgb)
    crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    return ben_graham(crop), info


def green_clahe(rgb: np.ndarray) -> np.ndarray:
    """Vessel/lesion input: CLAHE-enhanced green channel, float32 in [0, 1]."""
    g = rgb[..., 1]
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(g).astype(np.float32) / 255.0


def uncrop_map(map_sq: np.ndarray, info: CropInfo, interp=cv2.INTER_LINEAR) -> np.ndarray:
    """Map a square-crop map (any resolution) back onto the original image frame."""
    up = cv2.resize(map_sq.astype(np.float32), (info.side, info.side), interpolation=interp)
    out = np.zeros((info.orig_h, info.orig_w), np.float32)
    sx0, sy0 = max(0, info.x0), max(0, info.y0)
    sx1, sy1 = min(info.orig_w, info.x0 + info.side), min(info.orig_h, info.y0 + info.side)
    out[sy0:sy1, sx0:sx1] = up[sy0 - info.y0 : sy1 - info.y0, sx0 - info.x0 : sx1 - info.x0]
    return out


def read_rgb(path: str) -> np.ndarray:
    """Read any image (incl. DRIVE .tif / .gif) as RGB uint8."""
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        from PIL import Image

        return np.array(Image.open(path).convert("RGB"))
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
