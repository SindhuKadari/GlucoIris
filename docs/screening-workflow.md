# GlucoIris screening workflow

```mermaid
flowchart TD
  A(["Clinician signs in / enters demo mode"]) --> B["Dashboard: select or register patient"]
  B --> C["Create screening<br/>record operator, consent, and eye plan"]
  C --> D["Acquire cfundus image<br/>upload · camera · bundled sample"]
  D --> E{"Valid JPEG/PNG?<br/>≤20 MB · short side ≥256 px"}
  E -- "No" --> D
  E -- "Yes" --> F["Store image and metadata"]
  F --> G["Assess image quality<br/>FastAPI when reachable; browser heuristic fallback"]
  G --> H{"Quality result"}
  H -- "Ungradeable" --> I["Show reasons and recapture guidance"]
  I --> D
  H -- "Borderline" --> J{"Clinician accepts with written reason?"}
  J -- "No" --> D
  J -- "Yes" --> K["Record override in audit trail"]
  H -- "Acceptable" --> L{"Inference service reachable?"}
  K --> L

  L -- "Yes" --> M["POST /v1/analyze<br/>decode and validate image"]
  M --> N["Run available model modules independently"]
  N --> N1["EfficientNet-B4<br/>binary DR score + Grad-CAM"]
  N --> N2["ViT-S/16<br/>five-class grade + attribution"]
  N --> N3["Vessel U-Net<br/>vessel mask"]
  N --> N4["Lesion U-Net<br/>lesion masks + boxes"]
  N1 --> O["Return module statuses, results,<br/>and evidence artifact URLs"]
  N2 --> O
  N3 --> O
  N4 --> O

  L -- "No" --> P{"Bundled demo fixture?"}
  P -- "Yes" --> Q["Scripted simulated result<br/>labelled SIMULATED"]
  P -- "No" --> R["Model result unavailable<br/>no fabricated output"]
  O --> S["Save job, results, and evidence"]
  Q --> S
  R --> S
  S --> T["Clinician reviews output and evidence"]
  T --> U{"Clinician action"}
  U -- "Request recapture" --> D
  U -- "Save review" --> V["Record clinical findings and follow-up"]
  V --> W["Finalise report"]
  W --> X["Create immutable revision<br/>and audit event"]
  X --> Y["View or download PDF<br/>English · Telugu · Hindi"]
```

An unavailable or failed model module does not substitute another module's output. The clinician can review available evidence and the report records missing modules.
