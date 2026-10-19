"""EfficientNet-B4 binary DR screen (No DR vs DR) + Grad-CAM.

Mirrors the project's Colab training notebook exactly (user-trained weights,
`GlucoIris_EfficientNet_B4_Final.pth`):
  * CropFundus: grey-mean > 10 mask → bounding box + 2% padding → centred square
    pad with black → Resize(380, 380) → ToTensor → ImageNet normalisation.
  * Head: torchvision efficientnet_b4 with classifier[1] = Linear(1792, 1);
    sigmoid → P(DR), DR = APTOS grades 1–4. Decision threshold 0.5 (as trained).
  * Grad-CAM: target layer `features[-1]`, gradients of the single logit,
    channel-mean weights, ReLU, min–max normalised (same as the notebook).
The heatmap is mapped back through the crop/pad so it aligns with the ORIGINAL image.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageOps

SIZE = 380
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]
META = {
    "model_name": "efficientnet_b4 (torchvision) · binary head",
    "task": "DR detection: No DR (grade 0) vs DR (grades 1–4)",
    "dataset": "APTOS 2019 (user-trained in Colab; 70/15/15 stratified split, seed 42)",
    "threshold": 0.5,
    "input": "CropFundus (grey>10, 2% pad, square) → 380×380 → ImageNet normalisation",
    "explainability": "Grad-CAM on features[-1]",
    "version": "effnet-b4-aptos-binary-1.0 (user-trained)",
}


@dataclass
class B4Crop:
    x0: int  # crop box in original pixels (inclusive start)
    y0: int
    w: int
    h: int
    left: int  # square padding added around the crop
    top: int
    size: int  # side of the padded square


def crop_fundus(img: Image.Image, threshold: int = 10, padding_ratio: float = 0.02) -> tuple[Image.Image, B4Crop]:
    """Exact re-implementation of the notebook's CropFundus, also returning the mapping."""
    a = np.array(img)
    gray = np.mean(a, axis=2)
    mask = gray > threshold
    H, W = a.shape[:2]
    if not mask.any():
        s = max(W, H)
        return img, B4Crop(0, 0, W, H, 0, 0, s)
    ys, xs = np.where(mask)
    x_min, x_max, y_min, y_max = xs.min(), xs.max(), ys.min(), ys.max()
    mx, my = int((x_max - x_min + 1) * padding_ratio), int((y_max - y_min + 1) * padding_ratio)
    x_min, x_max = max(0, x_min - mx), min(W - 1, x_max + mx)
    y_min, y_max = max(0, y_min - my), min(H - 1, y_max + my)
    cropped = img.crop((int(x_min), int(y_min), int(x_max) + 1, int(y_max) + 1))
    w, h = cropped.size
    size = max(w, h)
    left, top = (size - w) // 2, (size - h) // 2
    right, bottom = size - w - left, size - h - top
    cropped = ImageOps.expand(cropped, border=(left, top, right, bottom), fill=(0, 0, 0))
    return cropped, B4Crop(int(x_min), int(y_min), w, h, left, top, size)


def build_b4() -> nn.Module:
    from torchvision import models

    m = models.efficientnet_b4(weights=None)
    m.classifier[1] = nn.Linear(m.classifier[1].in_features, 1)
    return m


class B4Screen:
    def __init__(self, state_dict: dict, device: str = "cpu"):
        from torchvision import transforms

        self.device = device
        self.model = build_b4()
        self.model.load_state_dict(state_dict)
        self.model.to(device).eval()
        self.tf = transforms.Compose([transforms.Resize((SIZE, SIZE)), transforms.ToTensor(), transforms.Normalize(MEAN, STD)])
        self._acts = self._grads = None
        layer = self.model.features[-1]
        layer.register_forward_hook(lambda _m, _i, o: setattr(self, "_acts", o))
        layer.register_full_backward_hook(lambda _m, _gi, go: setattr(self, "_grads", go[0]))

    def __call__(self, rgb: np.ndarray) -> dict:
        img = Image.fromarray(rgb)
        sq, mp = crop_fundus(img)
        x = self.tf(sq).unsqueeze(0).to(self.device)
        self.model.zero_grad(set_to_none=True)
        x.requires_grad_(True)
        logit = self.model(x).squeeze()
        prob = float(torch.sigmoid(logit).detach())
        logit.backward()
        w = self._grads.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((w * self._acts).sum(dim=1)).squeeze().detach().cpu().numpy()
        cam -= cam.min()
        if cam.max() > 0:
            cam /= cam.max()
        heat = self._to_original(cam, mp, rgb.shape[1], rgb.shape[0])
        return {"probability": prob, "heat": heat}

    @staticmethod
    def _to_original(cam: np.ndarray, mp: B4Crop, W: int, H: int) -> np.ndarray:
        sq = cv2.resize(cam.astype(np.float32), (mp.size, mp.size), interpolation=cv2.INTER_LINEAR)
        crop = sq[mp.top : mp.top + mp.h, mp.left : mp.left + mp.w]
        out = np.zeros((H, W), np.float32)
        out[mp.y0 : mp.y0 + mp.h, mp.x0 : mp.x0 + mp.w] = crop
        return out


def jet_rgba(heat: np.ndarray, min_alpha: float = 0.08) -> np.ndarray:
    """Jet colour map (as in the notebook) with value-driven alpha for overlays."""
    col = cv2.applyColorMap((np.clip(heat, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_JET)
    rgba = np.dstack([cv2.cvtColor(col, cv2.COLOR_BGR2RGB), (np.where(heat < min_alpha, 0, 0.35 + 0.65 * heat) * 255).astype(np.uint8)])
    return rgba


def jet_blend(rgb: np.ndarray, heat: np.ndarray, fov: np.ndarray | None = None) -> np.ndarray:
    """0.5 × original + 0.5 × jet heatmap (the notebook's overlay), inside the retinal field."""
    col = cv2.cvtColor(cv2.applyColorMap((np.clip(heat, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_JET), cv2.COLOR_BGR2RGB)
    blend = (0.5 * rgb.astype(np.float32) + 0.5 * col.astype(np.float32)).astype(np.uint8)
    if fov is not None:
        blend = np.where(fov[..., None] > 0, blend, rgb)
    return blend
