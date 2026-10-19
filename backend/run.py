"""Start the GlucoIris model server from any working directory.

    python backend/run.py            (from the project folder)
    python ..\\backend\\run.py         (from frontend/)
    npm run backend                  (from frontend/)
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

import uvicorn  # noqa: E402

if __name__ == "__main__":
    port = int(os.environ.get("GLUCOIRIS_PORT", "8000"))
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=port)
