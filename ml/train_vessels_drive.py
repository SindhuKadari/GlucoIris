"""Train the retinal vessel segmentation U-Net on DRIVE (CPU-friendly).

DRIVE training images 21–40 carry 1st-observer manual masks (the test-set masks
are not in the supplied archive), so 21–36 are used for training and 37–40 are
held out for validation. Patch-based training on the CLAHE green channel.

Usage (repo root):
    python ml/train_vessels_drive.py --epochs 40 --out ml/weights/unet_drive.pt
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles
from glucoiris_ml.models import UNet  # noqa: E402
from glucoiris_ml.preprocess import green_clahe, read_rgb  # noqa: E402
from glucoiris_ml.metrics import binary_seg_metrics  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVE = os.path.join(ROOT, "data", "raw", "drive", "DRIVE", "training")


def load(ids):
    xs, ys, ms = [], [], []
    for i in ids:
        rgb = read_rgb(os.path.join(DRIVE, "images", f"{i}_training.tif"))
        xs.append(green_clahe(rgb))
        ys.append((np.array(Image.open(os.path.join(DRIVE, "1st_manual", f"{i}_manual1.gif"))) > 127).astype(np.float32))
        ms.append((np.array(Image.open(os.path.join(DRIVE, "mask", f"{i}_training_mask.gif"))) > 127).astype(np.float32))
    return xs, ys, ms


def sample_batch(xs, ys, ms, n, size, rng):
    bx, by = np.zeros((n, 1, size, size), np.float32), np.zeros((n, 1, size, size), np.float32)
    for k in range(n):
        i = rng.integers(len(xs))
        h, w = xs[i].shape
        for _ in range(20):  # prefer patches centred inside the FOV
            y, x = rng.integers(0, h - size), rng.integers(0, w - size)
            if ms[i][y + size // 2, x + size // 2] > 0:
                break
        px, py = xs[i][y : y + size, x : x + size], ys[i][y : y + size, x : x + size]
        if rng.random() < 0.5:
            px, py = px[:, ::-1], py[:, ::-1]
        if rng.random() < 0.5:
            px, py = px[::-1], py[::-1]
        r = rng.integers(4)
        px, py = np.rot90(px, r), np.rot90(py, r)
        gamma = rng.uniform(0.8, 1.25)
        px = np.clip(px, 0, 1) ** gamma * rng.uniform(0.9, 1.1)
        bx[k, 0], by[k, 0] = px, py
    return torch.from_numpy(bx), torch.from_numpy(by)


def normalise(x, mean, std):
    return (x - mean) / std


@torch.no_grad()
def predict_full(model, img, mean, std):
    """Fully-convolutional whole-image inference (pad to a multiple of 16)."""
    h, w = img.shape
    ph, pw = (16 - h % 16) % 16, (16 - w % 16) % 16
    t = torch.from_numpy(np.pad(normalise(img, mean, std), ((0, ph), (0, pw)), mode="reflect"))[None, None]
    prob = torch.sigmoid(model(t))[0, 0, :h, :w]
    flip = torch.sigmoid(model(torch.flip(t, [-1])))[0, 0, :, :].flip(-1)[:h, :w]  # horizontal-flip TTA
    return ((prob + flip) / 2).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--iters", type=int, default=150)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--patch", type=int, default=96)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--base", type=int, default=16)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(ROOT, "ml", "weights", "unet_drive.pt"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    train_ids, val_ids = list(range(21, 37)), list(range(37, 41))
    xs, ys, ms = load(train_ids)
    vx, vy, vm = load(val_ids)
    mean = float(np.mean([x[m > 0].mean() for x, m in zip(xs, ms)]))
    std = float(np.mean([x[m > 0].std() for x, m in zip(xs, ms)]))
    pos = float(np.mean([y[m > 0].mean() for y, m in zip(ys, ms)]))
    print(f"train {len(xs)} · val {len(vx)} · vessel fraction {pos:.3f} · norm {mean:.3f}±{std:.3f}")

    model = UNet(1, 1, base=args.base)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * args.iters)
    pos_weight = torch.tensor([(1 - pos) / pos * 0.5])
    best, history = None, []
    t0 = time.time()
    for ep in range(args.epochs):
        model.train()
        tot = 0.0
        for _ in range(args.iters):
            bx, by = sample_batch(xs, ys, ms, args.batch, args.patch, rng)
            logits = model(normalise(bx, mean, std))
            p = torch.sigmoid(logits)
            dice = 1 - (2 * (p * by).sum() + 1) / (p.sum() + by.sum() + 1)
            loss = F.binary_cross_entropy_with_logits(logits, by, pos_weight=pos_weight) + dice
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        model.eval()
        probs = [predict_full(model, x, mean, std) for x in vx]
        met = binary_seg_metrics(np.concatenate([p[m > 0] for p, m in zip(probs, vm)]), np.concatenate([y[m > 0] for y, m in zip(vy, vm)]))
        history.append({"epoch": ep + 1, "loss": tot / args.iters, **met})
        print(f"ep {ep + 1:3d}  loss {tot / args.iters:.4f}  val AUC {met['auc']:.4f}  Dice {met['dice']:.4f} @t={met['threshold']:.2f}  ({time.time() - t0:.0f}s)")
        if best is None or met["dice"] > best["metrics"]["dice"]:
            best = {"state": {k: v.clone() for k, v in model.state_dict().items()}, "metrics": met, "epoch": ep + 1}

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    meta = {
        "model": "UNet",
        "params": {"in_ch": 1, "out_ch": 1, "base": args.base, "depth": 4},
        "input": "CLAHE green channel, z-normalised; fundus resized so FOV diameter ≈ 540px (DRIVE scale)",
        "norm": {"mean": mean, "std": std},
        "threshold": best["metrics"]["threshold"],
        "fov_diameter_px": 540,
        "dataset": "DRIVE training 21–36 (train), 37–40 (validation); 1st-observer manual masks",
        "best_epoch": best["epoch"],
        "val_metrics": best["metrics"],
        "version": f"unet-drive-1.0-ep{best['epoch']}",
    }
    torch.save({"state_dict": best["state"], "meta": meta}, args.out)
    rep = os.path.join(ROOT, "ml", "reports", "vessels_drive.json")
    os.makedirs(os.path.dirname(rep), exist_ok=True)
    with open(rep, "w") as fh:
        json.dump({"meta": meta, "history": history}, fh, indent=1)
    print(f"saved {args.out} (best epoch {best['epoch']}, val Dice {best['metrics']['dice']:.4f}, AUC {best['metrics']['auc']:.4f})")


if __name__ == "__main__":
    main()
