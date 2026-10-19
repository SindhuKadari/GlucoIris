"""Evaluate the deployed DR models on the IDRiD Disease Grading test set (103 images).

  * EfficientNet-B4 (binary): DR = IDRiD grade >= 1, decision threshold 0.5 (as trained).
  * ViT (five-class): accuracy, macro-F1, quadratic weighted kappa, confusion matrix, and the
    referable-DR flag (grade >= 2) from p2+p3+p4 >= threshold.

Both models were trained on APTOS 2019, so this is an external (cross-dataset) evaluation.

Usage:
  python ml/evaluate_idrid_grading.py --images "<…>/b. Testing Set" --labels "<…>/b. IDRiD_Disease Grading_Testing Labels.csv"
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glucoiris_ml.inference import GlucoIrisPipeline, _artifact_size  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def auc(scores: np.ndarray, labels: np.ndarray) -> float:
    pos, neg = scores[labels == 1], scores[labels == 0]
    if not len(pos) or not len(neg):
        return float("nan")
    return float(((pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()) / (len(pos) * len(neg)))


def binary(pred: np.ndarray, y: np.ndarray) -> dict:
    tp, tn = int(((pred == 1) & (y == 1)).sum()), int(((pred == 0) & (y == 0)).sum())
    fp, fn = int(((pred == 1) & (y == 0)).sum()), int(((pred == 0) & (y == 1)).sum())
    return {
        "accuracy": (tp + tn) / len(y),
        "sensitivity": tp / max(1, tp + fn),
        "specificity": tn / max(1, tn + fp),
        "ppv": tp / max(1, tp + fp),
        "npv": tn / max(1, tn + fn),
        "confusion": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
    }


def qwk(y: np.ndarray, p: np.ndarray, k: int = 5) -> float:
    o = np.zeros((k, k))
    for a, b in zip(y, p):
        o[a, b] += 1
    w = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    e = np.outer(o.sum(1), o.sum(0)) / o.sum()
    return float(1 - (w * o).sum() / max(1e-9, (w * e).sum()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "ml", "reports", "idrid_grading_test_eval.json"))
    a = ap.parse_args()

    with open(a.labels, newline="") as f:
        rows = [r for r in csv.reader(f)][1:]
    labels = {r[0].strip(): int(r[1]) for r in rows if r and r[0].strip()}
    pipe = GlucoIrisPipeline(os.path.join(ROOT, "ml", "weights"))
    assert pipe.b4 is not None and pipe.vit is not None, "both EfficientNet-B4 and ViT weights are required"

    names, y, b4p, vitp = [], [], [], []
    t0 = time.time()
    for name, grade in sorted(labels.items()):
        rgb = cv2.cvtColor(cv2.imread(os.path.join(a.images, f"{name}.jpg")), cv2.COLOR_BGR2RGB)
        aw, ah = _artifact_size(*rgb.shape[1::-1])
        b4p.append(pipe.b4(rgb)["probability"])
        vitp.append(pipe._classify(rgb, aw, ah)["probabilities"])
        names.append(name)
        y.append(grade)
        print(f"{len(y):3d}/{len(labels)} {name} grade {grade}  B4 {b4p[-1]:.3f}  ViT argmax {int(np.argmax(vitp[-1]))}", flush=True)

    y, b4p, vitp = np.array(y), np.array(b4p), np.array(vitp)
    vit_pred = vitp.argmax(1)
    ref_t = float(pipe.vit_meta.get("referable_threshold", 0.5))
    any_dr = (y >= 1).astype(int)
    referable = (y >= 2).astype(int)
    f1s = []
    for c in range(5):
        tp, fp, fn = ((vit_pred == c) & (y == c)).sum(), ((vit_pred == c) & (y != c)).sum(), ((vit_pred != c) & (y == c)).sum()
        f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
    conf = [[int(((y == i) & (vit_pred == j)).sum()) for j in range(5)] for i in range(5)]
    report = {
        "dataset": "IDRiD Disease Grading — official test set",
        "n_images": int(len(y)),
        "grade_distribution": {str(g): int((y == g).sum()) for g in range(5)},
        "seconds": round(time.time() - t0, 1),
        "efficientnet_b4_any_dr": {"threshold": 0.5, "auc": auc(b4p, any_dr), **binary((b4p >= 0.5).astype(int), any_dr)},
        "vit_five_class": {
            "accuracy": float((vit_pred == y).mean()),
            "macro_f1": float(np.mean(f1s)),
            "per_class_f1": {str(c): float(f) for c, f in enumerate(f1s)},
            "quadratic_weighted_kappa": qwk(y, vit_pred),
            "confusion_matrix_rows_true_cols_pred": conf,
        },
        "vit_any_dr": {"auc": auc(vitp[:, 1:].sum(1), any_dr), **binary((vit_pred >= 1).astype(int), any_dr)},
        "vit_referable_dr": {"threshold": ref_t, "auc": auc(vitp[:, 2:].sum(1), referable), **binary((vitp[:, 2:].sum(1) >= ref_t).astype(int), referable)},
        "per_image": [{"image": n, "grade": int(g), "b4_p_dr": round(float(p), 4), "vit_probs": [round(float(v), 4) for v in vp]} for n, g, p, vp in zip(names, y, b4p, vitp)],
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "per_image"}, indent=1))


if __name__ == "__main__":
    main()
