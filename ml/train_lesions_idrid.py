"""Train the multi-label lesion segmentation U-Net on IDRiD 'A. Segmentation'.

Classes (sigmoid, multi-label): microaneurysms, haemorrhages, hard exudates,
soft exudates. ResNet34-encoder U-Net (ImageNet init), patch training with
lesion-biased sampling, BCE (per-class pos_weight) + soft Dice loss.

Expected layout (as downloaded from IEEE Dataport):
  <data>/1. Original Images/a. Training Set/IDRiD_01.jpg …
  <data>/2. All Segmentation Groundtruths/a. Training Set/1. Microaneurysms/IDRiD_01_MA.tif …
  (b. Testing Set likewise)

Usage
  Colab GPU:  python ml/train_lesions_idrid.py --data "/content/A. Segmentation" --epochs 80
  CPU smoke:  python ml/train_lesions_idrid.py --synthetic --epochs 1 --size 256 --patch 128
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

import cv2
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles
from glucoiris_ml.metrics import average_precision  # noqa: E402
from glucoiris_ml.models import LESION_CLASSES, ResUNet  # noqa: E402
from glucoiris_ml.preprocess import crop_to_fundus, read_rgb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUFFIX = {"microaneurysms": ("1. Microaneurysms", "MA"), "haemorrhages": ("2. Haemorrhages", "HE"),
          "hard_exudates": ("3. Hard Exudates", "EX"), "soft_exudates": ("4. Soft Exudates", "SE")}
IMNET_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
IMNET_STD = np.array([0.229, 0.224, 0.225], np.float32)


def load_split(data: str, split: str, size: int):
    folder = "a. Training Set" if split == "train" else "b. Testing Set"
    imgs = sorted(glob.glob(os.path.join(data, "1. Original Images", folder, "*.jpg")))
    X, Y = [], []
    for p in imgs:
        stem = os.path.splitext(os.path.basename(p))[0]
        rgb = read_rgb(p)
        crop, info = crop_to_fundus(rgb)
        masks = []
        for c in LESION_CLASSES:
            sub, code = SUFFIX[c]
            mp = os.path.join(data, "2. All Segmentation Groundtruths", folder, sub, f"{stem}_{code}.tif")
            if os.path.exists(mp):
                m = read_rgb(mp).max(axis=2) > 0
            else:
                m = np.zeros(rgb.shape[:2], bool)
            mc, _ = crop_to_fundus_like(m, info)
            masks.append(cv2.resize(mc.astype(np.uint8), (size, size), interpolation=cv2.INTER_NEAREST))
        X.append(cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA))
        Y.append(np.stack(masks).astype(np.float32))
    return X, Y


def crop_to_fundus_like(mask: np.ndarray, info):
    canvas = np.zeros((info.side, info.side), mask.dtype)
    h, w = mask.shape
    sx0, sy0 = max(0, info.x0), max(0, info.y0)
    sx1, sy1 = min(w, info.x0 + info.side), min(h, info.y0 + info.side)
    canvas[sy0 - info.y0 : sy1 - info.y0, sx0 - info.x0 : sx1 - info.x0] = mask[sy0:sy1, sx0:sx1]
    return canvas, info


def synthetic(n: int, size: int, seed: int = 0):
    """Fake fundus-like images with drawn lesions, for CPU pipeline checks only."""
    rng = np.random.default_rng(seed)
    X, Y = [], []
    for _ in range(n):
        img = np.zeros((size, size, 3), np.uint8)
        cv2.circle(img, (size // 2, size // 2), int(size * 0.47), (190, 90, 40), -1)
        m = np.zeros((4, size, size), np.uint8)
        for c, (col, r) in enumerate([((120, 20, 20), 2), ((90, 10, 10), 7), ((240, 230, 120), 4), ((230, 220, 200), 10)]):
            for _ in range(rng.integers(1, 6)):
                x, y = rng.integers(size * 0.2, size * 0.8, 2)
                cv2.circle(img, (int(x), int(y)), r, col, -1)
                cv2.circle(m[c], (int(x), int(y)), r, 1, -1)
        X.append(img)
        Y.append(m.astype(np.float32))
    return X, Y


def to_tensor(img: np.ndarray) -> torch.Tensor:
    x = (img.astype(np.float32) / 255 - IMNET_MEAN) / IMNET_STD
    return torch.from_numpy(x.transpose(2, 0, 1))


def sample(X, Y, n, patch, rng, lesion_bias=0.7):
    bx, by = [], []
    for _ in range(n):
        i = rng.integers(len(X))
        img, m = X[i], Y[i]
        s = img.shape[0]
        if rng.random() < lesion_bias and m.any():
            c, ys, xs = np.nonzero(m)
            k = rng.integers(len(ys))
            cy, cx = ys[k], xs[k]
            y0 = int(np.clip(cy - rng.integers(patch // 4, 3 * patch // 4), 0, s - patch))
            x0 = int(np.clip(cx - rng.integers(patch // 4, 3 * patch // 4), 0, s - patch))
        else:
            y0, x0 = rng.integers(0, s - patch + 1, 2)
        pi, pm = img[y0 : y0 + patch, x0 : x0 + patch], m[:, y0 : y0 + patch, x0 : x0 + patch]
        if rng.random() < 0.5:
            pi, pm = pi[:, ::-1], pm[:, :, ::-1]
        if rng.random() < 0.5:
            pi, pm = pi[::-1], pm[:, ::-1]
        r = int(rng.integers(4))
        pi, pm = np.rot90(pi, r), np.rot90(pm, r, axes=(1, 2))
        pi = np.clip(pi.astype(np.float32) * rng.uniform(0.85, 1.15) + rng.uniform(-12, 12), 0, 255).astype(np.uint8)
        bx.append(to_tensor(np.ascontiguousarray(pi)))
        by.append(torch.from_numpy(np.ascontiguousarray(pm)))
    return torch.stack(bx), torch.stack(by)


@torch.no_grad()
def predict(model, img, device):
    t = to_tensor(img)[None].to(device)
    p = torch.sigmoid(model(t)) + torch.sigmoid(model(t.flip(-1))).flip(-1)
    return (p / 2)[0].cpu().numpy()


def evaluate(model, X, Y, device, thresholds=None):
    probs = [predict(model, x, device) for x in X]
    res = {}
    for ci, c in enumerate(LESION_CLASSES):
        sc = np.concatenate([p[ci].ravel() for p in probs])
        lb = np.concatenate([y[ci].ravel() for y in Y]) > 0
        idx = np.random.default_rng(0).choice(len(sc), size=min(len(sc), 2_000_000), replace=False)
        ap = average_precision(sc[idx], lb[idx])
        best = (0.5, -1.0)
        for t in ([thresholds[c]] if thresholds else np.arange(0.1, 0.91, 0.05)):
            pr = sc >= t
            tp, fp, fn = (pr & lb).sum(), (pr & ~lb).sum(), (~pr & lb).sum()
            d = 2 * tp / max(1, 2 * tp + fp + fn)
            if d > best[1]:
                best = (float(round(t, 2)), float(d))
        res[c] = {"aupr": ap, "threshold": best[0], "dice": best[1], "positive_pixels": int(lb.sum())}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="")
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--size", type=int, default=1024, help="square working resolution of the fundus crop")
    ap.add_argument("--patch", type=int, default=512)
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--iters", type=int, default=60)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--val", type=int, default=8, help="training images held out for threshold selection")
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--out", default=os.path.join(ROOT, "ml", "weights", "unet_lesions_idrid.pt"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    # Apple-silicon GPU (MPS) when there is no CUDA, so the model can train on a Mac.
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"device: {device}")
    if args.synthetic:
        X, Y = synthetic(10, args.size)
        Xt, Yt = synthetic(3, args.size, seed=9)
    else:
        X, Y = load_split(args.data, "train", args.size)
        Xt, Yt = load_split(args.data, "test", args.size)
    order = rng.permutation(len(X))
    vi, ti = order[: args.val], order[args.val :]
    Xv, Yv = [X[i] for i in vi], [Y[i] for i in vi]
    Xtr, Ytr = [X[i] for i in ti], [Y[i] for i in ti]
    pos = np.array([np.mean([y[c].mean() for y in Ytr]) for c in range(len(LESION_CLASSES))])
    print(f"train {len(Xtr)} · val {len(Xv)} · test {len(Xt)} · lesion pixel fractions {np.round(pos, 5).tolist()}")

    model = ResUNet(len(LESION_CLASSES), pretrained=not args.synthetic).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * args.iters)
    pw = torch.tensor(np.clip((1 - pos) / np.maximum(pos, 1e-6), 1, 50) ** 0.5, dtype=torch.float32, device=device).view(1, -1, 1, 1)
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    best, hist, t0 = None, [], time.time()
    for ep in range(args.epochs):
        model.train()
        tot = 0.0
        for _ in range(args.iters):
            bx, by = sample(Xtr, Ytr, args.batch, args.patch, rng)
            bx, by = bx.to(device), by.to(device)
            with torch.autocast(device_type=device, enabled=device == "cuda"):
                logits = model(bx)
            logits = logits.float()
            p = torch.sigmoid(logits)
            inter = (p * by).sum((0, 2, 3))
            dice = 1 - ((2 * inter + 1) / (p.sum((0, 2, 3)) + by.sum((0, 2, 3)) + 1)).mean()
            loss = F.binary_cross_entropy_with_logits(logits, by, pos_weight=pw) + dice
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
        if (ep + 1) % max(1, args.epochs // 10) == 0 or ep == args.epochs - 1:
            model.eval()
            vres = evaluate(model, Xv, Yv, device)
            m_ap = float(np.nanmean([v["aupr"] for v in vres.values()]))
            hist.append({"epoch": ep + 1, "loss": tot / args.iters, "val_mAUPR": m_ap, "val": vres})
            print(f"ep {ep + 1:3d}  loss {tot / args.iters:.4f}  val mAUPR {m_ap:.4f}  ({time.time() - t0:.0f}s)")
            if best is None or m_ap > best["map"]:
                best = {"map": m_ap, "epoch": ep + 1, "val": vres, "state": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}}

    model.load_state_dict(best["state"])
    model.eval()
    thresholds = {c: best["val"][c]["threshold"] for c in LESION_CLASSES}
    test = evaluate(model, Xt, Yt, device, thresholds)
    print("TEST per class:", {c: (round(v["aupr"], 3), round(v["dice"], 3)) for c, v in test.items()})
    meta = {
        "model": "ResUNet(resnet34)",
        "classes": LESION_CLASSES,
        "input": f"square fundus crop resized to {args.size}px RGB, ImageNet normalisation",
        "size": args.size,
        "thresholds": thresholds,
        "best_epoch": best["epoch"],
        "val_metrics": best["val"],
        "test_metrics": test,
        "dataset": "synthetic (smoke test)" if args.synthetic else "IDRiD A. Segmentation (54 train incl. held-out val / 27 test)",
        "smoke_test": bool(args.synthetic),
        "version": f"resunet-lesions-idrid-1.0{'-smoke' if args.synthetic else ''}",
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    torch.save({"state_dict": best["state"], "meta": meta}, args.out)
    rep = os.path.join(ROOT, "ml", "reports", f"lesions_idrid{'_smoke' if args.synthetic else ''}.json")
    os.makedirs(os.path.dirname(rep), exist_ok=True)
    json.dump({"meta": meta, "history": hist}, open(rep, "w"), indent=1, default=float)
    print(f"saved {args.out}")


if __name__ == "__main__":
    main()
