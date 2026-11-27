"""Downloads the face models into worker/models (or $MODELS_DIR). Run once; the Dockerfile runs it at build time.

YuNet (MIT, OpenCV Zoo) for detection; AuraFace v1 (Apache-2.0, fal.ai) for 512-d embeddings.
"""

import os
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "face_detection_yunet_2023mar.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "glintr100.onnx": "https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx",
}

out = Path(os.environ.get("MODELS_DIR", Path(__file__).parent / "models"))
out.mkdir(parents=True, exist_ok=True)
for name, url in MODELS.items():
    dest = out / name
    if dest.exists() and dest.stat().st_size > 100_000:
        print(f"ok    {name}")
        continue
    print(f"get   {name} …", flush=True)
    tmp = dest.with_suffix(".part")
    urllib.request.urlretrieve(url, tmp)
    if tmp.stat().st_size < 100_000:
        sys.exit(f"download of {name} looks wrong ({tmp.stat().st_size} bytes)")
    tmp.rename(dest)
print("models ready in", out)
