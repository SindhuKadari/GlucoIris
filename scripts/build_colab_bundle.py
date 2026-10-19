"""Build the Colab bundle: notebooks + a zip of the ml/ code.

Writes:
  ml/colab/01_train_vit_aptos.ipynb
  ml/colab/02_train_lesions_idrid.ipynb
  ml/colab/glucoiris_ml_code.zip   (upload this to MyDrive/GlucoIris/)

Run from the repo root:  python scripts/build_colab_bundle.py
"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ml", "colab")


def nb(cells):
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"name": "python3", "display_name": "Python 3"}},
        "cells": [
            {"cell_type": c[0], "metadata": {}, "source": c[1], **({"outputs": [], "execution_count": None} if c[0] == "code" else {})}
            for c in cells
        ],
    }


COMMON = [
    ("markdown", "**Runtime → Change runtime type → GPU (T4 or better)** before running.\n\nResearch prototype — results are not clinically validated."),
    ("code", "from google.colab import drive\ndrive.mount('/content/drive')\nBASE = '/content/drive/MyDrive/GlucoIris'\nimport os; os.makedirs(f'{BASE}/weights', exist_ok=True); os.makedirs(f'{BASE}/reports', exist_ok=True)"),
    ("code", "!pip -q install timm\n# Code bundle: upload ml/colab/glucoiris_ml_code.zip to MyDrive/GlucoIris/ first\n!rm -rf /content/ml && unzip -q -o \"$BASE/glucoiris_ml_code.zip\" -d /content/\n!ls /content/ml\n!nvidia-smi --query-gpu=name,memory.total --format=csv"),
]

VIT = nb(COMMON + [
    ("markdown", "## APTOS 2019 data\nUpload your `kaggle.json` (Kaggle → Account → Create API token) and accept the competition rules at kaggle.com/c/aptos2019-blindness-detection first."),
    ("code", "from google.colab import files\nif not os.path.exists('/root/.kaggle/kaggle.json'):\n    up = files.upload()  # choose kaggle.json\n    os.makedirs('/root/.kaggle', exist_ok=True)\n    open('/root/.kaggle/kaggle.json', 'wb').write(up['kaggle.json'])\n    os.chmod('/root/.kaggle/kaggle.json', 0o600)\n!pip -q install kaggle\n!kaggle competitions download -c aptos2019-blindness-detection -p /content/aptos_zip\n!mkdir -p /content/aptos && unzip -q -o /content/aptos_zip/aptos2019-blindness-detection.zip -d /content/aptos\n!ls /content/aptos && head -3 /content/aptos/train.csv"),
    ("markdown", "## Train the five-class ViT\nClass balancing (weighted sampler + class-weighted loss), augmentation, best-QWK selection, temperature scaling and a validation-chosen referable threshold are all inside `train_vit.py`."),
    ("code", "!cd /content && python ml/train_vit.py --dataset aptos --data /content/aptos \\\n    --model vit_base_patch16_224.augreg_in21k_ft_in1k --epochs 15 --batch 32 --workers 4 \\\n    --cache /content/aptos_cache --out \"$BASE/weights/vit_dr5.pt\""),
    ("code", "import json, glob\nrep = json.load(open('/content/ml/reports/vit_aptos.json')) if os.path.exists('/content/ml/reports/vit_aptos.json') else json.load(open(glob.glob(f'{BASE}/reports/vit_aptos.json')[0]))\nm = rep['meta']['test_metrics']\nprint('TEST accuracy', round(m['accuracy'],4), 'macro-F1', round(m['macro_f1'],4), 'QWK', round(m['qwk'],4))\nprint('Referable sens/spec', round(m['referable']['sensitivity'],4), round(m['referable']['specificity'],4), '@', m['referable']['threshold'])\nprint('Confusion matrix', m['confusion_matrix'])\n!cp /content/ml/reports/vit_aptos.json \"$BASE/reports/\" 2>/dev/null; ls -la \"$BASE/weights\""),
    ("markdown", "Download `MyDrive/GlucoIris/weights/vit_dr5.pt` and place it in the project at `ml/weights/vit_dr5.pt`, then restart the backend."),
])

LES = nb(COMMON + [
    ("markdown", "## IDRiD lesion segmentation data\nDownload **A. Segmentation.zip** from IEEE Dataport (IDRiD) and upload it to `MyDrive/GlucoIris/`."),
    ("code", "!unzip -q -o \"$BASE/A. Segmentation.zip\" -d /content/\n!ls \"/content/A. Segmentation\""),
    ("markdown", "## Train the lesion U-Net (MA, HE, EX, SE)\nResNet34-encoder U-Net, lesion-biased 512px patches from 1024px fundus crops, BCE + Dice. Thresholds are chosen on held-out training images; the 27 test images are evaluated once."),
    ("code", "!cd /content && python ml/train_lesions_idrid.py --data \"/content/A. Segmentation\" --epochs 80 --iters 60 --batch 8 \\\n    --size 1024 --patch 512 --out \"$BASE/weights/unet_lesions_idrid.pt\""),
    ("code", "import json\nrep = json.load(open('/content/ml/reports/lesions_idrid.json'))\nfor c, v in rep['meta']['test_metrics'].items():\n    print(f\"{c:15s} AUPR {v['aupr']:.3f}  Dice {v['dice']:.3f} @ {v['threshold']}\")\n!cp /content/ml/reports/lesions_idrid.json \"$BASE/reports/\"; ls -la \"$BASE/weights\""),
    ("markdown", "Download `MyDrive/GlucoIris/weights/unet_lesions_idrid.pt` into the project at `ml/weights/`, then restart the backend."),
])


def main():
    os.makedirs(OUT, exist_ok=True)
    json.dump(VIT, open(os.path.join(OUT, "01_train_vit_aptos.ipynb"), "w"), indent=1)
    json.dump(LES, open(os.path.join(OUT, "02_train_lesions_idrid.ipynb"), "w"), indent=1)
    zpath = os.path.join(OUT, "glucoiris_ml_code.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(os.path.join(ROOT, "ml")):
            rel = os.path.relpath(base, ROOT)
            if any(p in rel.replace("\\", "/") for p in ("ml/weights", "ml/cache", "ml/colab", "__pycache__", "ml/reports")):
                continue
            for f in files:
                if f.endswith(".py"):
                    z.write(os.path.join(base, f), os.path.join(rel, f))
    print("wrote notebooks and", zpath)
    print(zipfile.ZipFile(zpath).namelist())


if __name__ == "__main__":
    main()
