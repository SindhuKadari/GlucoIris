"""GlucoIris fundus image-quality screen (classical algorithm, v1).

A transparent, hand-built gradeability check — no learned model. Each dimension
is measured inside the retinal field of view (FOV), mapped to a 0–100 score and
a pass / warn / fail status with an actionable message:

  validity      is this a colour fundus photograph at all?
  sharpness     variance-of-Laplacian + Tenengrad + high-frequency energy
  brightness    mean luminance and under/over-exposed pixel fractions
  contrast      RMS contrast, green-channel dynamic range, local vessel contrast
  illumination  uniformity of luminance across a grid over the FOV
  glare         saturated / specular pixels and the largest glare blob
  noise         robust noise estimate (MAD of a high-pass residual)
  field         retinal-disc coverage and border clipping
  resolution    shortest image side

Thresholds were calibrated on IDRiD and DRIVE images plus synthetic
degradations (ml/evaluate_quality.py). They are NOT validated against human
gradeability labels; treat outputs as guidance (spec §6, §16).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import cv2
import numpy as np

from .preprocess import fov_mask

VERSION = "glucoiris-quality-1.0 (classical, unvalidated)"
WORK = 768  # analysis width in pixels


@dataclass
class Dimension:
    key: str
    label: str
    status: str  # pass | warn | fail
    score: float  # 0–100
    value: float
    detail: str


@dataclass
class QualityReport:
    outcome: str  # acceptable | borderline | ungradeable
    score: float  # 0–100 overall
    dimensions: list[Dimension] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    guidance: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    version: str = VERSION

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


# Calibrated thresholds: (fail, warn) — direction noted per metric.
# Calibrated on 120 IDRiD + 40 DRIVE images and 11 synthetic degradation types
# (see ml/reports/quality_eval.json). Real-image p1/p99 noted for reference.
T = {
    "sharpness_fail": 50.0,  # composite; real p1 ≈ 91, mild blur ≈ 80, strong blur ≈ 32
    "sharpness_warn": 85.0,
    "lum_low_fail": 18.0,  # mean L* (0–100) in FOV; real p1 ≈ 27, ×0.35 exposure ≈ 16
    "lum_low_warn": 25.0,
    "lum_high_warn": 65.0,  # real p99 ≈ 63
    "dark_frac_fail": 0.30,  # FOV fraction with L* < 10
    "clip_warn": 0.30,  # FOV fraction at sensor ceiling; real p99 ≈ 0.55 (bright IDRiD), over-exposed ≈ 0.69
    "clip_fail": 0.62,
    "range_fail": 35.0,  # green p99−p1; real p1 ≈ 42, dark ≈ 34
    "range_warn": 45.0,
    "local_fail": 1.0,  # vessel-scale (DoG) contrast; real p1 ≈ 1.25, low-contrast ≈ 1.35
    "local_warn": 1.45,
    "cv_warn": 0.30,  # illumination grid CV; real p99 ≈ 0.26
    "cv_fail": 0.50,
    "glare_warn": 0.004,  # real ≈ 0
    "glare_fail": 0.02,
    "noise_warn": 1.8,  # Immerkær sigma at 768px; real p99 ≈ 1.12, σ=22 noise ≈ 3.7
    "noise_fail": 3.0,
    "fov_fail": 0.30,
    "fov_full": 0.95,  # FOV fills the whole frame → disc edge not visible (cropped / zoomed)
    "res_fail": 480,
    "res_warn": 1000,
}


def _score(v: float, bad: float, good: float) -> float:
    """Linear 0–100 score: `bad` → 0, `good` → 100 (works for either direction)."""
    if good == bad:
        return 100.0
    s = (v - bad) / (good - bad)
    return float(np.clip(s, 0, 1) * 100)


def measure(rgb: np.ndarray) -> dict:
    """Raw measurements. `rgb` is uint8 RGB at any resolution."""
    h0, w0 = rgb.shape[:2]
    scale = WORK / w0
    im = cv2.resize(rgb, (WORK, max(1, round(h0 * scale))), interpolation=cv2.INTER_AREA)
    h, w = im.shape[:2]
    fov = fov_mask(im).astype(bool)
    n = h * w
    fov_frac = fov.sum() / n
    out: dict = {"short_side": int(min(h0, w0)), "fov_fraction": float(fov_frac)}
    if fov.sum() < 0.02 * n:
        out["valid_fov"] = False
        return out
    out["valid_fov"] = True

    ys, xs = np.nonzero(fov)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    out["fov_fill"] = float(fov.sum() / (bw * bh))
    # Disc clipped by the frame: share of FOV boundary lying on the image border.
    border = np.zeros_like(fov)
    border[[0, -1], :] = True
    border[:, [0, -1]] = True
    out["border_clip"] = float((fov & border).sum() / max(1, 2 * (bw + bh)))

    inner = cv2.erode(fov.astype(np.uint8), np.ones((int(WORK * 0.04),) * 2, np.uint8)).astype(bool)
    if inner.sum() < 100:
        inner = fov
    r, g, b = [im[..., i].astype(np.float32) for i in range(3)]
    out["red_green_ratio"] = float(r[inner].mean() / (g[inner].mean() + 1e-3))
    out["mean_red"] = float(r[inner].mean())

    lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB)
    L = lab[..., 0].astype(np.float32) * 100 / 255  # L* in 0–100
    Li = L[inner]
    out["luminance"] = float(Li.mean())
    out["dark_fraction"] = float((Li < 10).mean())
    out["bright_fraction"] = float((Li > 95).mean())
    out["rms_contrast"] = float(Li.std() / 100)
    gi = g[inner]
    out["green_range"] = float(np.percentile(gi, 99) - np.percentile(gi, 1))

    # Sharpness: three complementary focus measures on the green channel.
    gs = cv2.GaussianBlur(g, (0, 0), 0.8)
    lap = cv2.Laplacian(gs, cv2.CV_32F, ksize=3)
    gstd = gi.std() + 1e-3
    out["laplacian_var"] = float(lap[inner].var() / gstd)
    gx = cv2.Sobel(gs, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gs, cv2.CV_32F, 0, 1, ksize=3)
    out["tenengrad"] = float(np.sqrt(gx**2 + gy**2)[inner].mean() / gstd)
    # High-frequency energy ratio from the FFT of the central FOV square.
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    half = int(min(bw, bh) * 0.3)
    patch = g[cy - half : cy + half, cx - half : cx + half]
    if patch.size > 64:
        f = np.abs(np.fft.fftshift(np.fft.fft2(patch - patch.mean())))
        ph, pw = f.shape
        yy, xx = np.mgrid[0:ph, 0:pw]
        rad = np.hypot(yy - ph / 2, xx - pw / 2) / (min(ph, pw) / 2)
        out["hf_ratio"] = float(f[rad > 0.25].sum() / (f.sum() + 1e-6))
    else:
        out["hf_ratio"] = 0.0
    # Local vessel contrast: std of a band-pass (DoG) response.
    dog = cv2.GaussianBlur(g, (0, 0), 1.5) - cv2.GaussianBlur(g, (0, 0), 6)
    out["local_contrast"] = float(dog[inner].std())

    # Illumination uniformity: 4×4 grid of luminance means over the FOV box.
    cells = []
    for gy_ in range(4):
        for gx_ in range(4):
            y0 = ys.min() + gy_ * bh // 4
            x0 = xs.min() + gx_ * bw // 4
            m = inner[y0 : y0 + bh // 4, x0 : x0 + bw // 4]
            if m.sum() > 0.3 * m.size:
                cells.append(L[y0 : y0 + bh // 4, x0 : x0 + bw // 4][m].mean())
    out["illum_cv"] = float(np.std(cells) / (np.mean(cells) + 1e-3)) if len(cells) >= 4 else 0.0

    # Glare: near-saturated, low-chroma pixels; plus the largest such blob.
    sat = (r > 240) & (g > 230) & (b > 215) & inner
    out["glare_fraction"] = float(sat.sum() / inner.sum())
    if sat.any():
        n_lbl, _, stats, _ = cv2.connectedComponentsWithStats(sat.astype(np.uint8), 8)
        out["glare_blob"] = float(stats[1:, cv2.CC_STAT_AREA].max() / inner.sum()) if n_lbl > 1 else 0.0
    else:
        out["glare_blob"] = 0.0

    # Highlight clipping (over-exposure): any channel at the sensor ceiling.
    out["clipped_fraction"] = float((((r >= 250) | (g >= 250)) & inner).sum() / inner.sum())
    # Local vessel-scale contrast relative to brightness.
    out["local_contrast_rel"] = float(out["local_contrast"] / (gi.mean() + 1e-3))

    # Noise: Immerkær (1996) fast estimator on the green channel, flat regions only.
    kern = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    conv = np.abs(cv2.filter2D(g, cv2.CV_32F, kern))
    grad = np.sqrt(gx**2 + gy**2)
    flat = inner & (grad < np.percentile(grad[inner], 60))
    out["noise_sigma"] = float(np.sqrt(np.pi / 2) * conv[flat].mean() / 6) if flat.any() else 0.0
    return out


def sharpness_score(m: dict) -> float:
    """Composite 0–100 focus score from the three focus measures (log-scaled)."""
    s1 = _score(np.log10(m["laplacian_var"] + 1e-6), np.log10(0.05), np.log10(1.2))
    s2 = _score(m["tenengrad"], 0.08, 0.45)
    s3 = _score(m["hf_ratio"], 0.10, 0.40)
    return float(0.45 * s1 + 0.35 * s2 + 0.20 * s3)


def assess(rgb: np.ndarray) -> QualityReport:
    m = measure(rgb)
    dims: list[Dimension] = []

    def add(key, label, status, score, value, detail):
        dims.append(Dimension(key, label, status, round(float(score), 1), round(float(value), 4), detail))

    valid = (
        m.get("valid_fov", False)
        and m["fov_fraction"] > 0.2
        and m.get("fov_fill", 0) > 0.55
        and m.get("red_green_ratio", 0) > 1.2
    )
    add(
        "validity",
        "Fundus image validity",
        "pass" if valid else "fail",
        100 if valid else 0,
        m.get("red_green_ratio", 0),
        "Circular retinal field with fundus colouring detected." if valid else "Image does not appear to be a colour retinal fundus photograph.",
    )
    if not valid:
        return QualityReport(
            outcome="ungradeable",
            score=0.0,
            dimensions=dims,
            reasons=["Image does not appear to be a colour retinal fundus photograph."],
            guidance=["Capture or upload a colour fundus photograph centred on the retina.", "A normal phone or laptop camera image is not a fundus image."],
            metrics=m,
        )

    sh = sharpness_score(m)
    add(
        "sharpness",
        "Sharpness / focus",
        "fail" if sh < T["sharpness_fail"] else "warn" if sh < T["sharpness_warn"] else "pass",
        sh,
        m["laplacian_var"],
        "Image is out of focus — vessel edges are not resolved."
        if sh < T["sharpness_fail"]
        else "Image is slightly soft; microaneurysms may be missed."
        if sh < T["sharpness_warn"]
        else "Vessel edges are sharply resolved.",
    )

    lum, dark, clip = m["luminance"], m["dark_fraction"], m["clipped_fraction"]
    under_fail = lum < T["lum_low_fail"] or dark > T["dark_frac_fail"]
    over_fail = clip > T["clip_fail"]
    b_status = (
        "fail" if under_fail or over_fail
        else "warn" if lum < T["lum_low_warn"] or lum > T["lum_high_warn"] or clip > T["clip_warn"]
        else "pass"
    )
    b_score = min(_score(lum, 12, 32) if lum < 45 else _score(lum, 80, 58), _score(clip, 0.7, 0.1))
    add(
        "brightness",
        "Brightness / exposure",
        b_status,
        b_score,
        lum,
        "Image is severely under-exposed." if under_fail
        else "Image is over-exposed; highlights are clipped and detail is lost." if over_fail
        else "Image is dark." if lum < T["lum_low_warn"]
        else "Image is bright; some highlights are clipped." if lum > T["lum_high_warn"] or clip > T["clip_warn"]
        else "Exposure is within the expected range.",
    )

    rng, loc = m["green_range"], m["local_contrast"]
    c_status = (
        "fail" if rng < T["range_fail"] or loc < T["local_fail"]
        else "warn" if rng < T["range_warn"] or loc < T["local_warn"]
        else "pass"
    )
    add(
        "contrast",
        "Contrast",
        c_status,
        0.5 * _score(rng, 30, 110) + 0.5 * _score(loc, 0.9, 3.0),
        loc,
        "Contrast is too low to distinguish retinal structures." if c_status == "fail"
        else "Contrast is low; small lesions may be hard to see." if c_status == "warn"
        else "Contrast is adequate.",
    )

    cv = m["illum_cv"]
    add(
        "illumination",
        "Illumination uniformity",
        "fail" if cv > T["cv_fail"] else "warn" if cv > T["cv_warn"] else "pass",
        _score(cv, 0.8, 0.2),
        cv,
        "Illumination is strongly uneven (vignetting or shadow)." if cv > T["cv_fail"]
        else "Illumination is uneven across the field." if cv > T["cv_warn"]
        else "Illumination is even across the field.",
    )

    gl = max(m["glare_fraction"], m["glare_blob"])
    add(
        "glare",
        "Glare / reflections",
        "fail" if gl > T["glare_fail"] else "warn" if gl > T["glare_warn"] else "pass",
        _score(gl, 0.03, 0.0),
        gl,
        "Glare obscures retinal detail." if gl > T["glare_fail"]
        else "Small reflections present; check they do not cover lesions." if gl > T["glare_warn"]
        else "No significant glare.",
    )

    nz = m["noise_sigma"]
    add(
        "noise",
        "Noise",
        "fail" if nz > T["noise_fail"] else "warn" if nz > T["noise_warn"] else "pass",
        _score(nz, 3.5, 1.0),
        nz,
        "Image is very noisy (low light or high ISO)." if nz > T["noise_fail"]
        else "Visible sensor noise." if nz > T["noise_warn"]
        else "Noise level is low.",
    )

    fv = m["fov_fraction"]
    f_status = "fail" if fv < T["fov_fail"] else "warn" if fv > T["fov_full"] else "pass"
    add(
        "field",
        "Field coverage",
        f_status,
        _score(fv, 0.2, 0.55) if fv <= T["fov_full"] else 50.0,
        fv,
        "Retinal field is too small — re-centre the camera." if f_status == "fail"
        else "The edge of the retinal disc is not visible — the image may be cropped or zoomed." if f_status == "warn"
        else "Full retinal field is visible.",
    )

    rs = m["short_side"]
    add(
        "resolution",
        "Resolution",
        "fail" if rs < T["res_fail"] else "warn" if rs < T["res_warn"] else "pass",
        _score(rs, 400, 1400),
        rs,
        f"Resolution ({rs}px) is too low for grading." if rs < T["res_fail"]
        else f"Resolution ({rs}px short side) is below the recommended 1000px." if rs < T["res_warn"]
        else f"Resolution is adequate ({rs}px short side).",
    )

    fails = [d for d in dims if d.status == "fail"]
    warns = [d for d in dims if d.status == "warn"]
    outcome = "ungradeable" if fails else "borderline" if warns else "acceptable"
    weights = {"sharpness": 3, "brightness": 2, "contrast": 2, "illumination": 1, "glare": 1, "noise": 1, "field": 1.5, "resolution": 1}
    overall = sum(d.score * weights.get(d.key, 0) for d in dims) / sum(weights.values())
    advice = {
        "sharpness": "Refocus on the retina and ask the patient to keep still before recapturing.",
        "brightness": "Adjust flash intensity or allow further pupil dilation.",
        "contrast": "Check the lens is clean and the camera is aligned; dilate the pupil if media are hazy.",
        "illumination": "Realign the camera so the pupil is centred and illumination reaches the whole field.",
        "glare": "Move reflections off the retina by realigning the camera; clean the lens.",
        "noise": "Increase illumination rather than sensor gain.",
        "field": "Centre the fundus in the frame so the full retinal field is visible.",
        "resolution": "Use the camera's full-resolution output, not a screenshot or compressed copy.",
    }
    guidance = list(dict.fromkeys(advice[d.key] for d in fails + warns if d.key in advice))
    return QualityReport(
        outcome=outcome,
        score=round(overall, 1),
        dimensions=dims,
        reasons=[d.detail for d in fails + warns],
        guidance=guidance,
        metrics=m,
    )
