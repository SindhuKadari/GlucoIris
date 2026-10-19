"""Train the five-class DR Vision Transformer (APTOS 2019; IDRiD for smoke tests).

Pipeline
  * Preprocessing: square fundus crop → Ben Graham colour normalisation → 256px cache.
  * Split: stratified train / validation / test (70 / 15 / 15, fixed seed).
  * Class balancing: WeightedRandomSampler (inverse-sqrt frequency) AND
    class-weighted cross-entropy with label smoothing.
  * Augmentation: random resized crop, flips, 360° rotation, colour jitter,
    affine shear/translate, occasional blur.
  * Model: timm ViT-B/16 (ImageNet-21k), AdamW with lower backbone LR, cosine
    schedule with warm-up, mixed precision on GPU.
  * Selection: best validation quadratic weighted kappa.
  * Post-hoc: temperature scaling and referable-DR threshold chosen on VALIDATION
    (target sensitivity ≥ 0.90), then a single frozen evaluation on TEST.

Usage
  APTOS (Colab GPU):
    python ml/train_vit.py --dataset aptos --data /content/aptos --epochs 15
  Local smoke test on IDRiD grading images (CPU, tiny ViT):
    python ml/train_vit.py --dataset idrid --model vit_tiny_patch16_224.augreg_in21k_ft_in1k --epochs 1 --limit 60 --smoke
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import math
import os
import sys
import time

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

sys.path.insert(0, os.path.dirname(__file__))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles
from glucoiris_ml.metrics import classification_report, pick_referable_threshold, quadratic_weighted_kappa  # noqa: E402
from glucoiris_ml.models import DR_CLASSES, build_vit  # noqa: E402
from glucoiris_ml.preprocess import classifier_input, read_rgb  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEAN, STD = (0.5, 0.5, 0.5), (0.5, 0.5, 0.5)  # Ben Graham output is centred on 128


# ----------------------------------------------------------------------------- data
def list_aptos(data: str):
    rows = list(csv.DictReader(open(os.path.join(data, "train.csv"))))
    return [(os.path.join(data, "train_images", r["id_code"] + ".png"), int(r["diagnosis"])) for r in rows]


def list_idrid(data: str):
    base = os.path.join(data, "Disease Grading")
    out = []
    for split, folder in (("a. IDRiD_Disease Grading_Training Labels.csv", "a. Training Set"), ("b. IDRiD_Disease Grading_Testing Labels.csv", "b. Testing Set")):
        for r in csv.reader(open(os.path.join(base, "2. Groundtruths", split))):
            if r and r[0].startswith("IDRiD"):
                out.append((os.path.join(base, "1. Original Images", folder, r[0] + ".jpg"), int(r[1])))
    return out


def cache_images(items, cache_dir: str, size: int = 256):
    os.makedirs(cache_dir, exist_ok=True)
    out = []
    for i, (path, y) in enumerate(items):
        dst = os.path.join(cache_dir, os.path.splitext(os.path.basename(path))[0] + ".png")
        if not os.path.exists(dst):
            img, _ = classifier_input(read_rgb(path), size)
            cv2.imwrite(dst, cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        out.append((dst, y))
        if (i + 1) % 500 == 0:
            print(f"  cached {i + 1}/{len(items)}")
    return out


def stratified_split(items, seed: int, frac=(0.70, 0.15, 0.15)):
    rng = np.random.default_rng(seed)
    tr, va, te = [], [], []
    for c in sorted({y for _, y in items}):
        cls = [it for it in items if it[1] == c]
        rng.shuffle(cls)
        n = len(cls)
        a, b = int(round(n * frac[0])), int(round(n * (frac[0] + frac[1])))
        tr += cls[:a]
        va += cls[a:b]
        te += cls[b:]
    return tr, va, te


class FundusDS(Dataset):
    def __init__(self, items, train: bool, size: int = 224):
        from torchvision.transforms import v2 as T

        self.items = items
        norm = [T.ToDtype(torch.float32, scale=True), T.Normalize(MEAN, STD)]
        if train:
            self.tf = T.Compose([
                T.ToImage(),
                T.RandomResizedCrop(size, scale=(0.80, 1.0), ratio=(0.95, 1.05), antialias=True),
                T.RandomHorizontalFlip(),
                T.RandomVerticalFlip(),
                T.RandomRotation(180),
                T.RandomAffine(degrees=0, translate=(0.04, 0.04), shear=5),
                T.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.15, hue=0.02),
                T.RandomApply([T.GaussianBlur(5, sigma=(0.1, 1.2))], p=0.15),
                *norm,
            ])
        else:
            self.tf = T.Compose([T.ToImage(), T.Resize(size, antialias=True), T.CenterCrop(size), *norm])

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, y = self.items[i]
        img = cv2.cvtColor(cv2.imread(path), cv2.COLOR_BGR2RGB)
        return self.tf(img), y


# ----------------------------------------------------------------------------- train
@torch.no_grad()
def predict(model, loader, device, tta: bool = False):
    model.eval()
    logits, ys = [], []
    for x, y in loader:
        x = x.to(device)
        out = model(x)
        if tta:
            out = (out + model(torch.flip(x, [-1])) + model(torch.flip(x, [-2]))) / 3
        logits.append(out.float().cpu())
        ys.append(y)
    return torch.cat(logits), torch.cat(ys).numpy()


def fit_temperature(logits: torch.Tensor, y: np.ndarray) -> float:
    t = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([t], lr=0.05, max_iter=200)
    target = torch.from_numpy(y).long()

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / t.clamp(min=0.05), target)
        loss.backward()
        return loss

    opt.step(closure)
    return float(t.detach().clamp(min=0.05))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["aptos", "idrid"], default="aptos")
    ap.add_argument("--data", default="", help="dataset root (APTOS: folder with train.csv and train_images/)")
    ap.add_argument("--model", default="vit_base_patch16_224.augreg_in21k_ft_in1k")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-5, help="backbone LR (head uses 10×)")
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--smoothing", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--cache", default="")
    ap.add_argument("--target-sensitivity", type=float, default=0.90)
    ap.add_argument("--smoke", action="store_true", help="tiny run to verify the pipeline")
    ap.add_argument("--no-pretrained", action="store_true", help="random init (offline pipeline checks only)")
    ap.add_argument("--out", default=os.path.join(ROOT, "ml", "weights", "vit_dr5.pt"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if args.dataset == "aptos":
        items = list_aptos(args.data)
    else:
        items = list_idrid(args.data or os.path.join(ROOT, "data", "raw", "idrid"))
    if args.limit:
        rng = np.random.default_rng(args.seed)
        rng.shuffle(items)
        items = items[: args.limit]
    cache = args.cache or os.path.join(ROOT, "ml", "cache", f"{args.dataset}_256")
    print(f"{len(items)} images · caching preprocessed inputs to {cache}")
    items = cache_images(items, cache)
    tr, va, te = stratified_split(items, args.seed)
    counts = np.bincount([y for _, y in tr], minlength=5)
    print(f"split train {len(tr)} / val {len(va)} / test {len(te)} · train class counts {counts.tolist()}")

    # Class balancing (1): sampler with inverse-sqrt frequency weights.
    inv = 1.0 / np.sqrt(np.maximum(counts, 1))
    sampler = WeightedRandomSampler([inv[y] for _, y in tr], num_samples=len(tr), replacement=True)
    # Class balancing (2): loss weights (normalised inverse-sqrt frequency).
    cls_w = torch.tensor(inv / inv.sum() * 5, dtype=torch.float32, device=device)

    dl_tr = DataLoader(FundusDS(tr, True), batch_size=args.batch, sampler=sampler, num_workers=args.workers, drop_last=True)
    dl_va = DataLoader(FundusDS(va, False), batch_size=args.batch * 2, num_workers=args.workers)
    dl_te = DataLoader(FundusDS(te, False), batch_size=args.batch * 2, num_workers=args.workers)

    model = build_vit(args.model, num_classes=5, pretrained=not args.no_pretrained).to(device)
    head = [p for n, p in model.named_parameters() if n.startswith("head")]
    body = [p for n, p in model.named_parameters() if not n.startswith("head")]
    opt = torch.optim.AdamW([{"params": body, "lr": args.lr}, {"params": head, "lr": args.lr * 10}], weight_decay=args.wd)
    steps = args.epochs * max(1, len(dl_tr))
    warm = max(1, int(0.05 * steps))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps))))
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    crit = nn.CrossEntropyLoss(weight=cls_w, label_smoothing=args.smoothing)

    best, hist = None, []
    t0 = time.time()
    for ep in range(args.epochs):
        model.train()
        tot, n = 0.0, 0
        for i, (x, y) in enumerate(dl_tr):
            x, y = x.to(device), y.to(device)
            with torch.autocast(device_type=device, enabled=device == "cuda"):
                loss = crit(model(x), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item() * len(y)
            n += len(y)
            if args.smoke and i >= 3:
                break
        logits, yv = predict(model, dl_va, device)
        qwk = quadratic_weighted_kappa(yv, logits.argmax(1).numpy())
        acc = float((logits.argmax(1).numpy() == yv).mean())
        hist.append({"epoch": ep + 1, "train_loss": tot / max(1, n), "val_qwk": qwk, "val_acc": acc})
        print(f"ep {ep + 1:2d}  loss {tot / max(1, n):.4f}  val QWK {qwk:.4f}  acc {acc:.3f}  ({time.time() - t0:.0f}s)")
        if best is None or qwk > best["qwk"]:
            best = {"qwk": qwk, "epoch": ep + 1, "state": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}}

    model.load_state_dict(best["state"])
    lv, yv = predict(model, dl_va, device, tta=True)
    temp = fit_temperature(lv, yv)
    pv = F.softmax(lv / temp, 1).numpy()
    ref_t = pick_referable_threshold(yv, pv, args.target_sensitivity)
    lt, yt = predict(model, dl_te, device, tta=True)
    pt = F.softmax(lt / temp, 1).numpy()
    val_rep = classification_report(yv, pv, ref_t)
    test_rep = classification_report(yt, pt, ref_t)
    print(f"\nbest epoch {best['epoch']} · temperature {temp:.3f} · referable threshold {ref_t:.2f} (val sens ≥ {args.target_sensitivity})")
    print(f"TEST: acc {test_rep['accuracy']:.3f}  macro-F1 {test_rep['macro_f1']:.3f}  QWK {test_rep['qwk']:.4f}  "
          f"referable sens {test_rep['referable']['sensitivity']:.3f} spec {test_rep['referable']['specificity']:.3f}")

    meta = {
        "model_name": args.model,
        "classes": DR_CLASSES,
        "img_size": 224,
        "preprocess": "square fundus crop → Ben Graham (σ=side/30) → 224px; normalise mean 0.5 std 0.5",
        "temperature": temp,
        "referable_threshold": ref_t,
        "determinable_min": 0.40,
        "dataset": args.dataset,
        "split": {"train": len(tr), "val": len(va), "test": len(te), "seed": args.seed},
        "class_balancing": "WeightedRandomSampler (1/sqrt freq) + class-weighted CE, label smoothing %.2f" % args.smoothing,
        "augmentation": "RandomResizedCrop(0.8–1), H/V flip, rotation 180°, affine, colour jitter, blur p=0.15",
        "best_epoch": best["epoch"],
        "val_metrics": val_rep,
        "test_metrics": test_rep,
        "smoke_test": bool(args.smoke),
        "version": f"vit-dr5-{args.dataset}-1.0{'-smoke' if args.smoke else ''}",
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    torch.save({"state_dict": best["state"], "meta": meta}, args.out)
    rep = os.path.join(os.path.dirname(args.out).replace("weights", "reports"), f"vit_{args.dataset}{'_smoke' if args.smoke else ''}.json")
    os.makedirs(os.path.dirname(rep), exist_ok=True)
    json.dump({"meta": meta, "history": hist}, open(rep, "w"), indent=1)
    print(f"saved {args.out}\nreport {rep}")


if __name__ == "__main__":
    main()
