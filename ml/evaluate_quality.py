"""Calibrate and evaluate the classical quality screen.

Runs glucoiris_ml.quality on every local IDRiD (grading) and DRIVE image, plus
controlled synthetic degradations of a subset, and reports:
  * metric percentiles on real images (where thresholds must not fire),
  * metric values on degraded images (where they must fire),
  * outcome counts per group.

Usage (repo root):  python ml/evaluate_quality.py [--limit N] [--out ml/reports/quality_eval.json]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from collections import Counter

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles
from glucoiris_ml.preprocess import read_rgb  # noqa: E402
from glucoiris_ml.quality import assess, measure, sharpness_score  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")


def degradations(rgb: np.ndarray, seed: int):
    rng = np.random.default_rng(seed)
    f = rgb.astype(np.float32)
    h, w = rgb.shape[:2]
    s = w / 1600  # scale blur radii to resolution
    yield "blur_mild", cv2.GaussianBlur(rgb, (0, 0), 3 * s)
    yield "blur_strong", cv2.GaussianBlur(rgb, (0, 0), 9 * s)
    yield "dark", np.clip(f * 0.35, 0, 255).astype(np.uint8)
    yield "very_dark", np.clip(f * 0.18, 0, 255).astype(np.uint8)
    yield "overexposed", np.clip(f * 2.2 + 30, 0, 255).astype(np.uint8)
    mean = f.mean(axis=(0, 1), keepdims=True)
    yield "low_contrast", np.clip((f - mean) * 0.35 + mean, 0, 255).astype(np.uint8)
    gl = rgb.copy()
    cv2.circle(gl, (int(w * 0.62), int(h * 0.38)), int(min(h, w) * 0.14), (255, 255, 255), -1)
    yield "glare", cv2.GaussianBlur(gl, (0, 0), 2 * s)
    yield "noise", np.clip(f + rng.normal(0, 22, f.shape), 0, 255).astype(np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    vign = np.clip(1.25 - 1.1 * (xx / w), 0.08, 1.0)[..., None]
    yield "uneven", np.clip(f * vign, 0, 255).astype(np.uint8)
    yield "cropped", rgb[int(h * 0.15) : int(h * 0.65), int(w * 0.3) : int(w * 0.8)]
    yield "not_fundus", np.full_like(rgb, (120, 150, 200))


KEYS = ["luminance", "dark_fraction", "clipped_fraction", "rms_contrast", "green_range", "local_contrast", "local_contrast_rel", "illum_cv", "glare_fraction", "glare_blob", "noise_sigma", "fov_fraction", "laplacian_var", "tenengrad", "hf_ratio"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap real images per dataset (0 = all)")
    ap.add_argument("--degrade-every", type=int, default=25)
    ap.add_argument("--out", default=os.path.join(ROOT, "ml", "reports", "quality_eval.json"))
    args = ap.parse_args()

    idrid = sorted(glob.glob(os.path.join(RAW, "idrid", "Disease Grading", "1. Original Images", "*", "*.jpg")))
    drive = sorted(glob.glob(os.path.join(RAW, "drive", "DRIVE", "*", "images", "*.tif")))
    if args.limit:
        idrid, drive = idrid[: args.limit], drive[: args.limit]
    print(f"IDRiD {len(idrid)} - DRIVE {len(drive)}")

    real, degraded = [], []
    for i, path in enumerate(idrid + drive):
        rgb = read_rgb(path)
        ds = "IDRiD" if path in idrid else "DRIVE"
        rep = assess(rgb)
        m = rep.metrics
        real.append({"file": os.path.basename(path), "dataset": ds, "outcome": rep.outcome, "score": rep.score,
                     "sharpness": sharpness_score(m) if m.get("valid_fov") else 0,
                     "flags": [d.key for d in rep.dimensions if d.status != "pass"], **{k: m.get(k) for k in KEYS}})
        if ds == "IDRiD" and i % args.degrade_every == 0:
            for name, img in degradations(rgb, i):
                r2 = assess(img)
                m2 = r2.metrics
                degraded.append({"file": os.path.basename(path), "kind": name, "outcome": r2.outcome, "score": r2.score,
                                 "sharpness": sharpness_score(m2) if m2.get("valid_fov") else 0,
                                 "flags": [d.key for d in r2.dimensions if d.status != "pass"], **{k: m2.get(k) for k in KEYS}})
        if (i + 1) % 50 == 0:
            print(f"  {i + 1} images…")

    print("\nReal-image metric percentiles (p1 / p5 / p50 / p95 / p99):")
    for k in KEYS + ["sharpness"]:
        v = np.array([r[k] for r in real if r[k] is not None], dtype=float)
        if len(v):
            print(f"  {k:15s} " + " / ".join(f"{np.percentile(v, p):8.4f}" for p in (1, 5, 50, 95, 99)))
    for ds in ("IDRiD", "DRIVE"):
        c = Counter(r["outcome"] for r in real if r["dataset"] == ds)
        f = Counter(fl for r in real if r["dataset"] == ds for fl in r["flags"])
        print(f"\n{ds} outcomes: {dict(c)}  ·  flagged dimensions: {dict(f)}")
    print("\nDegradations (expected: borderline or ungradeable, flagging the right dimension):")
    by_kind: dict = {}
    for d in degraded:
        by_kind.setdefault(d["kind"], []).append(d)
    for k, rows in by_kind.items():
        c = Counter(r["outcome"] for r in rows)
        f = Counter(fl for r in rows for fl in r["flags"])
        print(f"  {k:13s} {dict(c)}  flags: {dict(f.most_common(3))}")
        med = {kk: np.median([r[kk] for r in rows if r.get(kk) is not None]) for kk in KEYS + ["sharpness"] if any(r.get(kk) is not None for r in rows)}
        print("      median: " + ", ".join(f"{kk}={v:.3f}" for kk, v in med.items()))

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump({"real": real, "degraded": degraded}, fh, indent=1)
    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
