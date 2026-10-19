# GlucoIris — Phase 1 workflow prototype

**Retinal screening. Evidence clinicians can review.**

A clinician-facing web prototype for assisted diabetic retinopathy (DR) screening, built to the
`GlucoIris_Project.md` specification (Phase 1: workflow prototype). It is a research prototype:
it does not diagnose, prescribe or replace a comprehensive eye examination, and no clinical
validation or regulatory clearance is claimed.

## Run it

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

Open the landing page, then **Run the demo** (or *Sign in → Continue with demo access*).

To regenerate the demo image library from the raw datasets (see *Data* below):

```bash
python scripts/prepare_demo_assets.py
```

## What is implemented, simulated, or future

| Capability | Status |
| --- | --- |
| Landing page (scroll-driven procedural fibre/iris animation, reduced-motion & mobile fallback) | **Implemented** |
| Demo sign-in; real-auth form validation with an honest "backend not connected" state; 8-hour session expiry | **Implemented** (real auth: future) |
| Dashboard: patient tiles, search, filters, review queue, in-progress list, counts from stored records | **Implemented** |
| Patient registration (validation, duplicate IDs), profile, encounter timeline, grade-over-time chart, visit comparison | **Implemented** |
| Encounter creation with consent record, explicit per-eye plan, "not screened" reasons, idempotency key | **Implemented** |
| Upload (JPEG/PNG, size/dimension checks, SHA-256, replace/remove/retry), browser camera with permission/fallback states, sample-image library | **Implemented** |
| Laterality hint from optic-disc position (warning only) | **Implemented** (heuristic) |
| Image-quality gate: validity, focus, illumination, glare, field, resolution with specific recapture guidance; ungradeable images blocked; borderline acceptance recorded | **Implemented** — heuristic, **not validated** |
| CLAHE enhancement (viewer-only, never a model input) | **Implemented** |
| Analysis jobs with per-module states (`unavailable / queued / processing / completed / failed`), retry, partial failure | **Implemented** (demo service) |
| Five-class classification, any-DR and referable-DR scores, referral flag, "unable to determine" | **Simulated** for bundled sample images; uploads get *no* model output |
| Attribution map | **Simulated**, clearly labelled, sample images only |
| Vessel overlay | **Reference annotation** (DRIVE manual masks) on DRIVE samples — not a model |
| Lesion segmentation (IDRiD U-Net) | **Future** — shown as unavailable |
| Evidence viewer: zoom/pan, opacity, legends, side-by-side, overlay alignment check | **Implemented** |
| Clinician review (grade, DME, findings, follow-up), model output preserved, agreement flag, unsaved-changes guard | **Implemented** |
| Reports: draft/final, immutable revisions with reasons, multi-page PDF with images, provenance, missing modules, demo watermark | **Implemented** |
| Audit trail | **Implemented** (browser-local) |
| FastAPI backend, PostgreSQL, private object storage, worker queue | **Future** — `HttpScreeningApi` targets the proposed endpoints |
| Real ViT inference (APTOS checkpoint) | **Future** (Phase 2) |
| Gemini assistant, hardware, research laboratory | **Out of scope** for Phase 1 |

### Demo scenarios built into the sample library

- `IDRiD_105` — predicted grade (mild) and referable flag disagree; both shown.
- `IDRiD_012` — low top-class score → "Unable to determine — review required".
- `IDRiD_016` — simulated output differs from the dataset reference grade.
- `IDRiD_029` — attribution module fails on the first attempt (partial failure + retry).
- `IDRiD_141` blur / dark / glare variants — fail the quality gate.
- DRIVE images — borderline (resolution) and carry the manual vessel reference overlay.

Synthetic patients reuse images from unrelated dataset subjects, so "history" is **not** real progression.

## Connecting a real backend

Set `VITE_API_BASE_URL` (e.g. in `frontend/.env.local`). The UI then uses `HttpScreeningApi`
(`frontend/src/services/screeningApi.ts`), which calls the endpoint contract in spec §12 and surfaces
failures instead of substituting demo results. Records are currently kept by the demo store
(`frontend/src/store/store.ts`); move them server-side before handling any real patient data.

## Project layout

```
frontend/
  src/pages/              routes from spec §5
  src/features/           landing animation, acquisition, viewer, review, reports, patients
  src/services/           model-service adapter, quality service, image intake
  src/lib/                quality heuristics, CLAHE, overlays, utilities
  src/store/              demo persistence (synthetic records only)
  src/demo/               fixture manifest, scripted demo behaviour, seed data
  public/demo/            resized sample images, thumbnails, vessel masks
scripts/
  prepare_demo_assets.py  builds public/demo from data/raw
  quality_metrics.py      Python reference for the quality heuristics
data/raw/                 extracted datasets (not committed)
```

## Data and attribution

- **IDRiD** — Indian Diabetic Retinopathy Image Dataset, Porwal et al., IEEE Dataport, CC BY 4.0.
  Disease-grading subset (`archive.zip`).
- **DRIVE** — Digital Retinal Images for Vessel Extraction, Staal et al. Research use; check the
  current terms before any redistribution beyond this prototype (`DRIVE.7z`).

Only small resized copies of a few images are bundled under `frontend/public/demo/`. Do not commit
patient records, credentials, private images or restricted datasets.
