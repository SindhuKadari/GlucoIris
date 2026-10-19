# GlucoIris models

Research prototype. **None of these models is clinically validated.** Every output is
labelled as model output in the app and reports, and missing models are shown as
unavailable — never simulated.

| # | Module | Method | Data | Where it trains | Weights file |
|---|---|---|---|---|---|
| 1 | Image quality | Classical algorithm (no learning): sharpness (variance of Laplacian + Tenengrad + FFT high-frequency ratio), brightness (L\*, dark/clipped fractions), contrast (green dynamic range + vessel-scale DoG contrast), illumination uniformity (4×4 grid CV), glare, noise (Immerkær), field coverage, resolution, fundus validity | Calibrated on IDRiD + DRIVE + synthetic degradations | Runs anywhere | — |
| 2 | DR grade (5 classes) | ViT-B/16 (timm, ImageNet-21k) with class balancing (weighted sampler + class-weighted CE, label smoothing), augmentation, temperature scaling, validation-chosen referable threshold | APTOS 2019 | Colab GPU (`colab/01_train_vit_aptos.ipynb`) | `weights/vit_dr5.pt` |
| 2b | Explainability | Grad-CAM on the ViT's last block, mapped back to the original image | — | — | (uses ViT) |
| 2c | Any-DR screen + Grad-CAM | **User-trained EfficientNet-B4** (binary: grade 0 vs 1–4), CropFundus → 380px, Grad-CAM on `features[-1]` (same as the training notebook), jet 50/50 overlay in reports | APTOS 2019 (trained in Colab) | Already trained | `weights/effnet_b4_dr_binary.pth` |
| 3 | Vessel mask | U-Net (CLAHE green channel, patch training, BCE + Dice) | DRIVE | Local CPU (`train_vessels_drive.py`) | `weights/unet_drive.pt` |
| 4 | Lesions + boxes | ResNet34-encoder U-Net, multi-label (MA, HE, EX, SE); masks → connected components → bounding boxes on the original image | IDRiD A. Segmentation | Colab GPU (`colab/02_train_lesions_idrid.ipynb`) | `weights/unet_lesions_idrid.pt` |

## Run the inference service

```bash
pip install -r requirements.txt
python -m uvicorn backend.app.main:app --port 8000
```

The web app detects the service at `http://localhost:8000` (or `VITE_API_BASE_URL`).
When it is running, new analyses use the real models; quality checks use the Python
algorithm. `GET /v1/health` lists which modules are loaded.

## Train

```bash
# Quality: calibration / evaluation report (ml/reports/quality_eval.json)
python ml/evaluate_quality.py

# Vessels (CPU, ~45 min)
python ml/train_vessels_drive.py --epochs 40

# ViT and lesions: upload ml/colab/glucoiris_ml_code.zip to MyDrive/GlucoIris/,
# open the notebooks in ml/colab/ on Colab (GPU) and follow the cells.
# Put the resulting .pt files in ml/weights/ and restart the service.
python scripts/build_colab_bundle.py   # rebuild the bundle after code changes
```

Smoke tests (pipeline checks only — **not** usable models; the service ignores
them unless `GLUCOIRIS_ALLOW_SMOKE=1`):

```bash
python ml/train_vit.py --dataset idrid --model vit_tiny_patch16_224.augreg_in21k_ft_in1k --epochs 1 --limit 60 --workers 0 --smoke --no-pretrained --out ml/weights/vit_dr5_smoke.pt
python ml/train_lesions_idrid.py --synthetic --epochs 2 --iters 4 --batch 4 --size 256 --patch 128 --val 3 --out ml/weights/unet_lesions_smoke.pt
```

## Evaluation discipline

* Splits are fixed by seed; thresholds (referable cut-off, lesion thresholds) and
  temperature are chosen on **validation** data only, then the test set is scored once.
* Reports (`ml/reports/*.json`) record per-class recall, macro-F1, QWK, referable
  sensitivity/specificity, confusion matrix (ViT); AUC/Dice (vessels); AUPR/Dice per
  lesion class.
* DRIVE's test-set masks are not in the supplied archive, so the vessel model is
  validated on training images 37–40 (held out).
* Grad-CAM shows regions associated with the predicted class — not verified lesions.
* The B4 checkpoint holds weights only (no metrics); its test metrics live in the training
  notebook. On the bundled IDRiD sample `IDRiD_118` (reference grade 0) it predicts DR with
  P = 0.93 — a cross-dataset false positive worth investigating before any claims.
