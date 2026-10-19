"""End-to-end GlucoIris inference: quality → classification + Grad-CAM → vessels → lesions → boxes.

Every module is optional: it reports `unavailable` (with the reason) when its
weights are missing, and `failed` (with the error) if it raises. A module never
substitutes another's output, and nothing is fabricated when weights are absent.
All maps are returned in the ORIGINAL image frame (same aspect ratio), so the
frontend can overlay them pixel-aligned.
"""
from __future__ import annotations

import os
import time
import traceback

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from . import quality as qa
from .cam_boxes import cam_regions, draw_cam_boxes
from .effnet import META as B4_META, B4Screen, jet_blend, jet_rgba
from .explain import ViTGradCAM
from .lesions import LESION_COLOR, LESION_LABEL, boxes_from_probs, colour_mask, draw_boxes
from .models import DR_CLASSES, LESION_CLASSES, ResUNet, UNet, build_vit
from .preprocess import classifier_input, crop_to_fundus, fov_mask, green_clahe, uncrop_map

ARTIFACT_MAX_W = 1600  # artifacts are downscaled to this width, aspect preserved


def _meta(ck: dict) -> dict:
    """Metadata from either layout: {"meta": {...}} or top-level keys (model_name, img_size, num_classes)."""
    if "meta" in ck:
        return ck["meta"]
    return {k: ck[k] for k in ("model_name", "img_size", "num_classes", "smoke_test", "params") if k in ck}


def _state(ck: dict) -> dict:
    """State dict under either key name."""
    return ck["state_dict"] if "state_dict" in ck else ck["model_state_dict"]


def _artifact_size(w: int, h: int) -> tuple[int, int]:
    if w <= ARTIFACT_MAX_W:
        return w, h
    return ARTIFACT_MAX_W, int(round(h * ARTIFACT_MAX_W / w))


class GlucoIrisPipeline:
    def __init__(self, weights_dir: str, device: str | None = None, allow_smoke: bool = False):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.weights_dir = weights_dir
        self.allow_smoke = allow_smoke
        self.vit = self.vit_meta = self.cam = None
        self.vessel = self.vessel_meta = None
        self.lesion = self.lesion_meta = None
        self.b4 = None
        self.load_errors: dict[str, str] = {}
        self._load()

    # ------------------------------------------------------------------ loading
    def _ckpt(self, names: list[str]):
        for n in names:
            p = os.path.join(self.weights_dir, n)
            if os.path.exists(p):
                ck = torch.load(p, map_location="cpu", weights_only=False)
                if _meta(ck).get("smoke_test") and not self.allow_smoke:
                    continue
                return ck, n
        return None, None

    def _load(self):
        try:
            ck, _ = self._ckpt(["glucoiris_vit_best.pt", "vit_dr5.pt", "vit_dr5_smoke.pt"])
            if ck:
                meta = _meta(ck)
                m = build_vit(meta["model_name"], num_classes=5, pretrained=False)
                m.load_state_dict(_state(ck))
                self.vit, self.vit_meta = m.to(self.device).eval(), meta
                self.cam = ViTGradCAM(self.vit)
        except Exception as e:  # noqa: BLE001
            self.load_errors["classification"] = str(e)
        try:
            ck, _ = self._ckpt(["unet_drive.pt"])
            if ck:
                m = UNet(**_meta(ck)["params"])
                m.load_state_dict(_state(ck))
                self.vessel, self.vessel_meta = m.to(self.device).eval(), _meta(ck)
        except Exception as e:  # noqa: BLE001
            self.load_errors["vessels"] = str(e)
        try:
            ck, _ = self._ckpt(["unet_lesions_idrid.pt", "unet_lesions_smoke.pt"])
            if ck:
                m = ResUNet(len(LESION_CLASSES), pretrained=False)
                m.load_state_dict(_state(ck))
                self.lesion, self.lesion_meta = m.to(self.device).eval(), _meta(ck)
        except Exception as e:  # noqa: BLE001
            self.load_errors["lesions"] = str(e)

        try:
            p = os.path.join(self.weights_dir, "effnet_b4_dr_binary.pth")
            if os.path.exists(p):
                self.b4 = B4Screen(torch.load(p, map_location="cpu", weights_only=True), self.device)
        except Exception as e:  # noqa: BLE001
            self.load_errors["dr_binary"] = str(e)

    def status(self) -> dict:
        def mod(model, meta, key, missing):
            if model is not None:
                return {"status": "available", "version": meta.get("version"), "smoke_test": bool(meta.get("smoke_test")), "meta": _summary(meta)}
            if key in self.load_errors:
                return {"status": "failed", "message": f"Weights could not be loaded: {self.load_errors[key]}"}
            return {"status": "unavailable", "message": missing}

        return {
            "quality": {"status": "available", "version": qa.VERSION},
            "classification": mod(self.vit, self.vit_meta, "classification", "ViT weights not found (place glucoiris_vit_best.pt in ml/weights/)."),
            "attribution": mod(self.vit, self.vit_meta, "classification", "Grad-CAM needs the ViT classifier weights."),
            "vessels": mod(self.vessel, self.vessel_meta, "vessels", "Vessel U-Net weights not found (ml/weights/unet_drive.pt)."),
            "dr_binary": mod(self.b4, B4_META, "dr_binary", "EfficientNet-B4 weights not found (ml/weights/effnet_b4_dr_binary.pth)."),
            "lesions": mod(self.lesion, self.lesion_meta, "lesions", "Lesion U-Net weights not found (ml/weights/unet_lesions_idrid.pt). Train with the Colab notebook."),
            "device": self.device,
        }

    # ------------------------------------------------------------------ modules
    def quality(self, rgb: np.ndarray) -> dict:
        return qa.assess(rgb).to_dict()

    @torch.no_grad()
    def _vessels(self, rgb: np.ndarray, aw: int, ah: int) -> dict:
        meta = self.vessel_meta
        crop, info = crop_to_fundus(rgb)
        side = int(meta.get("fov_diameter_px", 540) * 1.02)
        crop = cv2.resize(crop, (side, side), interpolation=cv2.INTER_AREA)
        g = green_clahe(crop)
        x = (g - meta["norm"]["mean"]) / meta["norm"]["std"]
        pad = (16 - side % 16) % 16
        t = torch.from_numpy(np.pad(x, ((0, pad), (0, pad)), mode="reflect"))[None, None].float().to(self.device)
        p = torch.sigmoid(self.vessel(t)) + torch.sigmoid(self.vessel(t.flip(-1))).flip(-1)
        prob = (p / 2)[0, 0, :side, :side].cpu().numpy()
        full = uncrop_map(prob, info)
        full *= fov_mask(rgb)
        small = cv2.resize(full, (aw, ah), interpolation=cv2.INTER_AREA)
        mask = small >= meta["threshold"]
        rgba = np.zeros((ah, aw, 4), np.uint8)
        rgba[mask] = (99, 217, 255, 255)
        fov = fov_mask(cv2.resize(rgb, (aw, ah)))
        density = float(mask.sum() / max(1, fov.sum()))
        return {"rgba": rgba, "vessel_density": density, "threshold": meta["threshold"]}

    @torch.no_grad()
    def _lesions(self, rgb: np.ndarray, aw: int, ah: int) -> dict:
        meta = self.lesion_meta
        size = meta.get("size", 1024)
        crop, info = crop_to_fundus(rgb)
        crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
        x = (crop.astype(np.float32) / 255 - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        t = torch.from_numpy(x.transpose(2, 0, 1))[None].float().to(self.device)
        p = torch.sigmoid(self.lesion(t)) + torch.sigmoid(self.lesion(t.flip(-1))).flip(-1)
        p = (p / 2)[0].cpu().numpy()
        fov = fov_mask(rgb)
        probs = {c: uncrop_map(p[i], info) * fov for i, c in enumerate(LESION_CLASSES)}
        thr = meta["thresholds"]
        boxes = boxes_from_probs(probs, thr, scale_ref=4288)
        small = {c: cv2.resize(v, (aw, ah), interpolation=cv2.INTER_AREA) for c, v in probs.items()}
        rgba = colour_mask(small, thr)
        counts = {c: sum(1 for b in boxes if b["class"] == c) for c in LESION_CLASSES}
        return {"rgba": rgba, "boxes": boxes, "counts": counts, "thresholds": thr}

    def _b4(self, rgb: np.ndarray, aw: int, ah: int) -> dict:
        r = self.b4(rgb)
        heat = cv2.resize(r["heat"], (aw, ah), interpolation=cv2.INTER_LINEAR)
        small = cv2.resize(rgb, (aw, ah), interpolation=cv2.INTER_AREA)
        fov = fov_mask(small)
        heat = heat * fov
        p, t = r["probability"], float(B4_META["threshold"])
        blend = jet_blend(small, heat, fov)
        regions = cam_regions(heat, fov)
        return {
            "result": {
                "probability": p,
                "threshold": t,
                "positive": p >= t,
                "label": "DR detected" if p >= t else "No DR detected",
                "model_name": B4_META["model_name"],
                "model_version": B4_META["version"],
                "task": B4_META["task"],
                "preprocessing": B4_META["input"],
                "explainability": B4_META["explainability"],
            },
            "rgba": jet_rgba(heat),
            "blend": blend,
            "regions": regions,
            "boxed": draw_cam_boxes(blend, regions),
        }

    def _classify(self, rgb: np.ndarray, aw: int, ah: int) -> dict:
        meta = self.vit_meta
        img, info = classifier_input(rgb, meta.get("img_size", 224))
        x = torch.from_numpy(((img.astype(np.float32) / 255 - 0.5) / 0.5).transpose(2, 0, 1))[None].to(self.device)
        cam, logits = self.cam(x, None)
        probs = F.softmax(logits / meta.get("temperature", 1.0), 1)[0].cpu().numpy().astype(float)
        heat = uncrop_map(cam, info)
        heat *= fov_mask(rgb)
        heat = cv2.resize(heat, (aw, ah), interpolation=cv2.INTER_LINEAR)
        heat = cv2.GaussianBlur(heat, (0, 0), max(1, aw / 300))
        heat = heat / (heat.max() + 1e-8)
        small = cv2.resize(rgb, (aw, ah), interpolation=cv2.INTER_AREA)
        sfov = fov_mask(small)
        blend = jet_blend(small, heat, sfov)
        regions = cam_regions(heat, sfov)
        grade = int(np.argmax(probs))
        ref_t = float(meta.get("referable_threshold", 0.5))
        referable = float(probs[2:].sum())
        return {
            "probabilities": [round(float(v), 4) for v in probs],
            "predicted_grade": grade,
            "predicted_label": DR_CLASSES[grade],
            "any_dr_score": float(probs[1:].sum()),
            "referable_dr_score": referable,
            "referable_threshold": ref_t,
            "referable_flag": referable >= ref_t,
            "determinable": float(probs.max()) >= float(meta.get("determinable_min", 0.4)),
            "calibration": "temperature-scaled" if meta.get("temperature", 1.0) != 1.0 else "uncalibrated",
            "temperature": float(meta.get("temperature", 1.0)),
            "model_version": meta.get("version"),
            "model_name": meta.get("model_name"),
            "preprocessing": meta.get("preprocess"),
            "heat": heat,
            "blend": blend,
            "regions": regions,
            "boxed": draw_cam_boxes(blend, regions),
            "cam_target": DR_CLASSES[grade],
        }

    # ------------------------------------------------------------------ pipeline
    def analyze(self, rgb: np.ndarray, run_quality_gate: bool = True) -> dict:
        h, w = rgb.shape[:2]
        aw, ah = _artifact_size(w, h)
        out: dict = {"image": {"width": w, "height": h, "artifact_width": aw, "artifact_height": ah}, "modules": {}, "timings_ms": {}}
        q = self.quality(rgb)
        out["quality"] = q
        if run_quality_gate and q["outcome"] == "ungradeable":
            msg = "Not run: image failed the quality gate."
            for k in ("dr_binary", "classification", "attribution", "vessels", "lesions"):
                out["modules"][k] = {"status": "unavailable", "message": msg}
            return out

        def run(key, fn, model, missing):
            if model is None:
                out["modules"][key] = {"status": "unavailable", "message": missing}
                return None
            t0 = time.time()
            try:
                res = fn(rgb, aw, ah)
                out["modules"][key] = {"status": "completed"}
                return res
            except Exception as e:  # noqa: BLE001
                out["modules"][key] = {"status": "failed", "message": f"{type(e).__name__}: {e}"}
                traceback.print_exc()
                return None
            finally:
                out["timings_ms"][key] = int((time.time() - t0) * 1000)

        st = self.status()
        b4 = run("dr_binary", self._b4, self.b4, st["dr_binary"].get("message", ""))
        if b4 is not None:
            out["dr_binary"] = b4["result"]
            out["gradcam_b4_rgba"] = b4["rgba"]
            out["gradcam_b4_blend_rgb"] = b4["blend"]
            out["gradcam_b4_regions"] = b4["regions"]
            out["gradcam_b4_boxes_rgb"] = b4["boxed"]
        cls = run("classification", self._classify, self.vit, st["classification"].get("message", ""))
        if cls is not None:
            out["classification"] = {k: v for k, v in cls.items() if k not in ("heat", "blend", "regions", "boxed")}
            # Same jet colour scale as the EfficientNet-B4 Grad-CAM, so the two maps are comparable.
            out["attribution_rgba"] = jet_rgba(cls["heat"])
            out["attribution_blend_rgb"] = cls["blend"]
            out["attribution_regions"] = cls["regions"]
            out["attribution_boxes_rgb"] = cls["boxed"]
            out["modules"]["attribution"] = {"status": "completed", "method": "Grad-CAM (ViT, last block, predicted class)"}
        else:
            out["modules"]["attribution"] = {"status": "unavailable" if self.vit is None else "failed", "message": "Requires the classifier."}
        ves = run("vessels", self._vessels, self.vessel, st["vessels"].get("message", ""))
        if ves is not None:
            out["vessels_rgba"] = ves["rgba"]
            out["vessels"] = {"vessel_density": ves["vessel_density"], "threshold": ves["threshold"], "version": self.vessel_meta.get("version")}
        les = run("lesions", self._lesions, self.lesion, st["lesions"].get("message", ""))
        if les is not None:
            out["lesions_rgba"] = les["rgba"]
            out["lesions"] = {"boxes": les["boxes"], "counts": les["counts"], "thresholds": les["thresholds"], "version": self.lesion_meta.get("version"),
                              "legend": [{"class": c, "label": LESION_LABEL[c], "color": "#%02x%02x%02x" % LESION_COLOR[c]} for c in LESION_CLASSES]}
            annotated = draw_boxes(rgb, les["boxes"])
            out["boxes_jpeg_rgb"] = cv2.resize(annotated, (aw, ah), interpolation=cv2.INTER_AREA)
        return out


def _summary(meta: dict) -> dict:
    keep = ("model_name", "dataset", "best_epoch", "temperature", "referable_threshold", "threshold", "thresholds", "size")
    s = {k: meta[k] for k in keep if k in meta}
    for k in ("test_metrics", "val_metrics"):
        if k in meta:
            m = meta[k]
            s[k] = {kk: m[kk] for kk in ("accuracy", "macro_f1", "qwk", "auc", "dice", "referable") if kk in m} if isinstance(m, dict) and "accuracy" in m or "dice" in m else m
    return s
