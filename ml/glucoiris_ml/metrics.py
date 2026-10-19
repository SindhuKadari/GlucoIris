"""Evaluation metrics without extra dependencies (no scikit-learn needed)."""
from __future__ import annotations

import numpy as np


def roc_auc(scores: np.ndarray, labels: np.ndarray) -> float:
    """ROC AUC via the Mann–Whitney rank statistic."""
    labels = labels.astype(bool)
    n_pos, n_neg = labels.sum(), (~labels).sum()
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(scores, kind="mergesort")
    ranks = np.empty(len(scores), dtype=np.float64)
    ranks[order] = np.arange(1, len(scores) + 1)
    # average ranks for ties
    s_sorted = scores[order]
    i = 0
    while i < len(s_sorted):
        j = i
        while j + 1 < len(s_sorted) and s_sorted[j + 1] == s_sorted[i]:
            j += 1
        if j > i:
            ranks[order[i : j + 1]] = (i + j + 2) / 2
        i = j + 1
    return float((ranks[labels].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def average_precision(scores: np.ndarray, labels: np.ndarray) -> float:
    labels = labels.astype(bool)
    if labels.sum() == 0:
        return float("nan")
    order = np.argsort(-scores)
    tp = np.cumsum(labels[order])
    precision = tp / np.arange(1, len(labels) + 1)
    return float((precision * labels[order]).sum() / labels.sum())


def binary_seg_metrics(probs: np.ndarray, labels: np.ndarray, thresholds=None) -> dict:
    """AUC + best-Dice threshold sweep for a flat array of pixel probabilities."""
    labels = labels.astype(bool)
    rng = np.random.default_rng(0)
    idx = rng.choice(len(probs), size=min(len(probs), 400_000), replace=False)
    auc = roc_auc(probs[idx], labels[idx])
    best = None
    for t in thresholds if thresholds is not None else np.arange(0.2, 0.81, 0.05):
        pred = probs >= t
        tp = (pred & labels).sum()
        fp = (pred & ~labels).sum()
        fn = (~pred & labels).sum()
        tn = (~pred & ~labels).sum()
        dice = 2 * tp / max(1, 2 * tp + fp + fn)
        if best is None or dice > best["dice"]:
            best = {
                "threshold": float(round(t, 2)),
                "dice": float(dice),
                "sensitivity": float(tp / max(1, tp + fn)),
                "specificity": float(tn / max(1, tn + fp)),
                "accuracy": float((tp + tn) / max(1, len(labels))),
            }
    return {"auc": auc, **best}


def quadratic_weighted_kappa(y_true: np.ndarray, y_pred: np.ndarray, k: int = 5) -> float:
    o = np.zeros((k, k))
    for a, b in zip(y_true, y_pred):
        o[a, b] += 1
    w = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    e = np.outer(o.sum(1), o.sum(0)) / max(1, o.sum())
    return float(1 - (w * o).sum() / max(1e-9, (w * e).sum()))


def classification_report(y_true: np.ndarray, probs: np.ndarray, referable_threshold: float = 0.5) -> dict:
    """Five-class + referable-DR metrics (referable = grades 2–4)."""
    y_pred = probs.argmax(1)
    k = probs.shape[1]
    cm = np.zeros((k, k), int)
    for a, b in zip(y_true, y_pred):
        cm[a, b] += 1
    recall = [float(cm[i, i] / max(1, cm[i].sum())) for i in range(k)]
    prec = [float(cm[i, i] / max(1, cm[:, i].sum())) for i in range(k)]
    f1 = [2 * p * r / max(1e-9, p + r) for p, r in zip(prec, recall)]
    ref_true = y_true >= 2
    ref_score = probs[:, 2:].sum(1)
    ref_pred = ref_score >= referable_threshold
    tp, fn = int((ref_pred & ref_true).sum()), int((~ref_pred & ref_true).sum())
    tn, fp = int((~ref_pred & ~ref_true).sum()), int((ref_pred & ~ref_true).sum())
    return {
        "n": int(len(y_true)),
        "accuracy": float((y_pred == y_true).mean()),
        "macro_f1": float(np.mean(f1)),
        "qwk": quadratic_weighted_kappa(y_true, y_pred, k),
        "per_class_recall": recall,
        "confusion_matrix": cm.tolist(),
        "referable": {
            "threshold": referable_threshold,
            "sensitivity": tp / max(1, tp + fn),
            "specificity": tn / max(1, tn + fp),
            "auc": roc_auc(ref_score, ref_true),
            "tp": tp, "fn": fn, "tn": tn, "fp": fp,
        },
    }


def pick_referable_threshold(y_true: np.ndarray, probs: np.ndarray, min_sensitivity: float = 0.90) -> float:
    """Highest threshold whose referable sensitivity meets the target (validation data only)."""
    ref_true = y_true >= 2
    score = probs[:, 2:].sum(1)
    best = 0.5
    for t in np.arange(0.95, 0.04, -0.01):
        sens = ((score >= t) & ref_true).sum() / max(1, ref_true.sum())
        if sens >= min_sensitivity:
            best = float(round(t, 2))
            break
    return best
