"""Reference implementation of the browser quality heuristics (frontend/src/lib/quality.ts).
Used to calibrate thresholds on IDRiD/DRIVE samples and degraded variants."""
import cv2, numpy as np

W = 512

def metrics(bgr):
    h0, w0 = bgr.shape[:2]
    h = round(h0 * W / w0)
    im = cv2.resize(bgr, (W, h), interpolation=cv2.INTER_AREA).astype(np.float32)
    b, g, r = im[..., 0], im[..., 1], im[..., 2]
    fov = r > 25
    frac = fov.mean()
    ys, xs = np.nonzero(fov)
    if len(xs) == 0:
        return dict(fov=0)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    fill = fov.sum() / (bw * bh)
    # erode FOV by ~4% of width to avoid rim edges
    k = max(3, int(W * 0.04))
    inner = cv2.erode(fov.astype(np.uint8), np.ones((k, k), np.uint8)).astype(bool)
    mr, mg, mb = r[inner].mean(), g[inner].mean(), b[inner].mean()
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    lap = (np.roll(g, 1, 0) + np.roll(g, -1, 0) + np.roll(g, 1, 1) + np.roll(g, -1, 1) - 4 * g)
    lapv = lap[inner].var()
    # normalise focus by contrast so dark-but-sharp images are not called blurry
    sharp = lapv / (g[inner].std() + 1e-3)
    glare = ((r > 245) & (g > 235) & (b > 220) & inner).sum() / inner.sum()
    # quadrant unevenness
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    yy, xx = np.mgrid[0:h, 0:W]
    qs = []
    for qy in (yy < cy, yy >= cy):
        for qx in (xx < cx, xx >= cx):
            m = inner & qy & qx
            if m.sum() > 50: qs.append(lum[m].mean())
    uneven = (max(qs) - min(qs)) / (np.mean(qs) + 1e-3)
    return dict(fov=round(frac, 3), fill=round(fill, 3), rg=round(mr / (mg + 1e-3), 2), mr=round(mr, 1),
                lum=round(lum[inner].mean(), 1), sharp=round(sharp, 2), glare=round(glare, 4),
                uneven=round(uneven, 2), short=min(h0, w0))
