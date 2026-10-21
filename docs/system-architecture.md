# GlucoIris system architecture

```mermaid
flowchart LR
  subgraph Browser["Browser — React + TypeScript"]
    UI["Screening UI<br/>Patients · Acquire · Quality · Analyse · Review"]
    APIClient["Screening API adapter<br/>health check · quality · analysis"]
    Demo["Demo service<br/>scripted fixture results only"]
    Store["Zustand persist / localStorage<br/>patients · encounters · jobs · review · reports · audit"]
    Images[("IndexedDB<br/>uploaded image blobs")]
    Quality["Browser quality heuristic<br/>used if inference service is unavailable"]
    Report["Report model + jsPDF<br/>English · Telugu · Hindi"]
    UI --> APIClient
    UI --> Store
    UI --> Images
    UI --> Report
    APIClient -. "service unavailable" .-> Demo
    APIClient -. "quality fallback" .-> Quality
    Demo --> Store
    Quality --> Store
  end

  subgraph Backend["Optional inference service — FastAPI"]
    Routes["GET /v1/health<br/>POST /v1/quality<br/>POST /v1/analyze"]
    Validate["JPEG/PNG validation<br/>decode · ≤20 MB · minimum dimensions"]
    Pipeline["GlucoIris inference pipeline"]
    QGate["Image quality assessment"]
    B4["EfficientNet-B4<br/>binary DR + Grad-CAM"]
    ViT["ViT-S/16<br/>five-class grade + attribution"]
    Vessels["Vessel U-Net<br/>DRIVE"]
    Lesions["Lesion ResNet34 U-Net<br/>IDRiD"]
    ArtifactStore[("Local artifact directory<br/>PNG/JPG evidence files")]
    Routes --> Validate --> Pipeline
    Pipeline --> QGate
    Pipeline --> B4
    Pipeline --> ViT
    Pipeline --> Vessels
    Pipeline --> Lesions
    B4 --> ArtifactStore
    ViT --> ArtifactStore
    Vessels --> ArtifactStore
    Lesions --> ArtifactStore
  end

  APIClient -- "multipart image request" --> Routes
  Routes -- "JSON results + artifact URLs" --> APICclient
  ArtifactStore -- "static /artifacts URLs" --> Browser
  Store -- "report snapshot" --> Report

  FutureStore["Future deployment<br/>server-side database + private object storage"]
  Store -. "not implemented; browser-local demo persistence" .-> FutureStore
```

The inference service and trained modules are optional. Missing modules are reported as unavailable; demo predictions are limited to bundled fixtures and labelled simulated. Patient records and images are browser-local in the current app. PostgreSQL, private object storage, and a worker queue are future work.
