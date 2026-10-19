"""Build the demo fixture library used by the frontend's demo mode.

Reads the locally extracted datasets in data/raw (see README) and writes
resized images, vessel reference masks and thumbnails into frontend/public/demo/
and the manifest into frontend/src/demo/fixtures.json. Run from the repository root:

    python scripts/prepare_demo_assets.py
"""
import csv
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "frontend" / "public" / "demo"
IDRID = RAW / "idrid" / "Disease Grading"
DRIVE = RAW / "drive" / "DRIVE"

# Two training images per reference grade, chosen for variety.
IDRID_PICKS = {
    0: ["IDRiD_118", "IDRiD_140"],
    1: ["IDRiD_021", "IDRiD_105"],
    2: ["IDRiD_016", "IDRiD_029"],
    3: ["IDRiD_001", "IDRiD_012"],
    4: ["IDRiD_005", "IDRiD_008"],
}
DRIVE_PICKS = ["21", "22", "23", "24"]
DEGRADE_SOURCE = "IDRiD_141"


def estimate_laterality(bgr):
    """Rough laterality from optic-disc position in a macula-centred image.

    The disc is the brightest large structure; when it sits right of centre the
    image is most likely a right eye. This is a heuristic for demo labelling only.
    """
    g = cv2.resize(bgr, (512, round(bgr.shape[0] * 512 / bgr.shape[1])))[..., 1].astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 12)
    _, _, _, (x, _) = cv2.minMaxLoc(g)
    return "right" if x > g.shape[1] / 2 else "left"


def save_jpg(bgr, path, width):
    h = round(bgr.shape[0] * width / bgr.shape[1])
    small = cv2.resize(bgr, (width, h), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), small, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return width, h


def read_any(path):
    if path.suffix.lower() in (".tif", ".gif"):
        return cv2.cvtColor(np.array(Image.open(path).convert("RGB")), cv2.COLOR_RGB2BGR)
    return cv2.imread(str(path))


def main():
    (OUT / "images").mkdir(parents=True, exist_ok=True)
    (OUT / "thumbs").mkdir(parents=True, exist_ok=True)
    (OUT / "masks").mkdir(parents=True, exist_ok=True)

    labels = {}
    with open(IDRID / "2. Groundtruths" / "a. IDRiD_Disease Grading_Training Labels.csv") as f:
        for row in list(csv.reader(f))[1:]:
            if row and row[0]:
                labels[row[0]] = (int(row[1]), int(row[2]))

    fixtures = []

    def add(fid, bgr, *, dataset, source, laterality, ref_grade=None, ref_dme=None,
            scenario="standard", vessel_mask=None, fov_mask=None, width=1600, note=None):
        w, h = save_jpg(bgr, OUT / "images" / f"{fid}.jpg", min(width, bgr.shape[1]))
        save_jpg(bgr, OUT / "thumbs" / f"{fid}.jpg", 320)
        item = {
            "id": fid,
            "dataset": dataset,
            "source": source,
            "image": f"/demo/images/{fid}.jpg",
            "thumb": f"/demo/thumbs/{fid}.jpg",
            "width": w,
            "height": h,
            "originalWidth": bgr.shape[1],
            "originalHeight": bgr.shape[0],
            "laterality": laterality,
            "lateralitySource": "estimated from optic-disc position",
            "referenceGrade": ref_grade,
            "referenceDmeRisk": ref_dme,
            "scenario": scenario,
            "vesselMask": vessel_mask,
            "note": note,
        }
        fixtures.append(item)

    train_dir = IDRID / "1. Original Images" / "a. Training Set"
    for grade, ids in IDRID_PICKS.items():
        for iid in ids:
            bgr = cv2.imread(str(train_dir / f"{iid}.jpg"))
            g, dme = labels[iid]
            assert g == grade, (iid, g, grade)
            add(iid.lower().replace("_", "-"), bgr, dataset="IDRiD", source=iid,
                laterality=estimate_laterality(bgr), ref_grade=g, ref_dme=dme)

    # Degraded variants of one grade-0 image to exercise the quality gate.
    base = cv2.imread(str(train_dir / f"{DEGRADE_SOURCE}.jpg"))
    lat = estimate_laterality(base)
    blur = cv2.GaussianBlur(base, (0, 0), 14)
    add("degraded-blur", blur, dataset="IDRiD (degraded)", source=DEGRADE_SOURCE, laterality=lat,
        scenario="blur", note="Synthetic Gaussian blur applied to demonstrate the focus check.")
    dark = (base.astype(np.float32) * 0.24).astype(np.uint8)
    add("degraded-dark", dark, dataset="IDRiD (degraded)", source=DEGRADE_SOURCE, laterality=lat,
        scenario="underexposed", note="Synthetic under-exposure applied to demonstrate the illumination check.")
    glare = base.copy()
    h, w = glare.shape[:2]
    cv2.circle(glare, (w // 2 + 300, h // 2 - 200), 420, (255, 255, 255), -1)
    glare = cv2.GaussianBlur(glare, (0, 0), 3)
    add("degraded-glare", glare, dataset="IDRiD (degraded)", source=DEGRADE_SOURCE, laterality=lat,
        scenario="glare", note="Synthetic glare patch applied to demonstrate the artefact check.")

    # DRIVE images with manual vessel annotations (reference, not model output).
    for n in DRIVE_PICKS:
        bgr = read_any(DRIVE / "training" / "images" / f"{n}_training.tif")
        manual = np.array(Image.open(DRIVE / "training" / "1st_manual" / f"{n}_manual1.gif").convert("L"))
        fid = f"drive-{n}"
        Image.fromarray(manual).save(OUT / "masks" / f"{fid}-vessels.png", optimize=True)
        add(fid, bgr, dataset="DRIVE", source=f"{n}_training", laterality=estimate_laterality(bgr),
            vessel_mask=f"/demo/masks/{fid}-vessels.png", width=bgr.shape[1])

    manifest = {
        "generated": "scripts/prepare_demo_assets.py",
        "attribution": {
            "IDRiD": "Indian Diabetic Retinopathy Image Dataset (IDRiD), Porwal et al., IEEE Dataport, CC BY 4.0.",
            "DRIVE": "DRIVE: Digital Retinal Images for Vessel Extraction, Staal et al., research use.",
        },
        "fixtures": fixtures,
    }
    manifest_path = ROOT / "frontend" / "src" / "demo" / "fixtures.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {len(fixtures)} fixtures to {OUT}")
    for fx in fixtures:
        print(fx["id"], fx["laterality"], fx["referenceGrade"], fx["scenario"])


if __name__ == "__main__":
    main()
