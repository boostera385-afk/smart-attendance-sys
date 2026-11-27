"""Face detection (YuNet, MIT) + alignment + 512-d embedding (AuraFace, Apache-2.0).

Both models are permissively licensed for commercial use (InsightFace pretrained weights are not).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# ArcFace 112×112 reference landmarks: eye (image-left), eye (image-right), nose, mouth corners
ARCFACE_REF = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float32,
)


@dataclass
class Face:
    box: tuple[int, int, int, int]  # x, y, w, h
    landmarks: np.ndarray           # 5×2
    score: float

    @property
    def width(self) -> int:
        return self.box[2]


class FaceEngine:
    def __init__(self, models_dir: Path, det_score: float = 0.8):
        import onnxruntime as ort  # heavy; imported only when the engine starts

        det = models_dir / "face_detection_yunet_2023mar.onnx"
        rec = models_dir / "glintr100.onnx"
        for p in (det, rec):
            if not p.exists():
                raise SystemExit(f"Model missing: {p} (run worker/download_models.py)")
        self.detector = cv2.FaceDetectorYN.create(str(det), "", (320, 320), det_score, 0.3, 5000)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # each camera thread runs its own inference; keep them from fighting
        self.session = ort.InferenceSession(str(rec), opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, img: np.ndarray, max_side: int = 1280) -> list[Face]:
        """Faces sorted largest first. Coordinates refer to the original image."""
        h, w = img.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        small = cv2.resize(img, (int(w * scale), int(h * scale))) if scale < 1 else img
        self.detector.setInputSize((small.shape[1], small.shape[0]))
        _, dets = self.detector.detect(small)
        faces: list[Face] = []
        for d in dets if dets is not None else []:
            d = d / np.array([scale] * 14 + [1.0], dtype=np.float32)
            x, y, bw, bh = (int(v) for v in d[:4])
            faces.append(Face((x, y, bw, bh), d[4:14].reshape(5, 2).astype(np.float32), float(d[14])))
        return sorted(faces, key=lambda f: f.width, reverse=True)

    @staticmethod
    def align(img: np.ndarray, face: Face) -> np.ndarray:
        m, _ = cv2.estimateAffinePartial2D(face.landmarks, ARCFACE_REF, method=cv2.LMEDS)
        return cv2.warpAffine(img, m, (112, 112), borderValue=0)

    def embed(self, img: np.ndarray, face: Face) -> np.ndarray:
        crop = self.align(img, face)
        x = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32)
        x = ((x - 127.5) / 127.5).transpose(2, 0, 1)[None]
        v = self.session.run(None, {self.input_name: x})[0][0]
        return v / (np.linalg.norm(v) + 1e-9)

    @staticmethod
    def sharpness(img: np.ndarray, face: Face) -> float:
        x, y, w, h = face.box
        roi = img[max(0, y): y + h, max(0, x): x + w]
        if roi.size == 0:
            return 0.0
        return float(cv2.Laplacian(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())

    @staticmethod
    def crop_jpeg(img: np.ndarray, face: Face, margin: float = 0.35, max_side: int = 256) -> bytes:
        """Face crop with a small margin only (never the whole frame) — see MASTER_PLAN §12."""
        x, y, w, h = face.box
        mx, my = int(w * margin), int(h * margin)
        H, W = img.shape[:2]
        roi = img[max(0, y - my): min(H, y + h + my), max(0, x - mx): min(W, x + w + mx)]
        s = min(1.0, max_side / max(roi.shape[:2]))
        if s < 1:
            roi = cv2.resize(roi, (int(roi.shape[1] * s), int(roi.shape[0] * s)))
        ok, buf = cv2.imencode(".jpg", roi, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return buf.tobytes() if ok else b""


def decode_image(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


class Gallery:
    """Approved embeddings in memory; cosine match with a margin over the next-best person."""

    def __init__(self) -> None:
        self.matrix = np.zeros((0, 512), np.float32)
        self.owners: list[str] = []

    def load(self, rows: list[tuple[str, list[float]]]) -> None:
        if rows:
            m = np.asarray([r[1] for r in rows], np.float32)
            m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
            self.matrix, self.owners = m, [r[0] for r in rows]
        else:
            self.matrix, self.owners = np.zeros((0, 512), np.float32), []

    def match(self, v: np.ndarray, allowed: set[str] | None = None) -> tuple[str | None, float, float]:
        """→ (best employee, best score, runner-up score of a different employee)."""
        if not self.owners:
            return None, 0.0, 0.0
        sims = self.matrix @ v
        best: dict[str, float] = {}
        for owner, s in zip(self.owners, sims):
            if allowed is not None and owner not in allowed:
                continue
            if s > best.get(owner, -1.0):
                best[owner] = float(s)
        if not best:
            return None, 0.0, 0.0
        ranked = sorted(best.items(), key=lambda kv: kv[1], reverse=True)
        second = ranked[1][1] if len(ranked) > 1 else 0.0
        return ranked[0][0], ranked[0][1], second


class Voter:
    """Accept a person only after N agreeing frames within a time window (anti-flicker / anti-spoof aid)."""

    def __init__(self, votes: int, window: float):
        self.votes, self.window = votes, window
        self.seen: dict[str, list[float]] = {}

    def add(self, employee: str, now: float) -> bool:
        hits = [t for t in self.seen.get(employee, []) if now - t <= self.window] + [now]
        self.seen[employee] = hits
        if len(hits) >= self.votes:
            self.seen[employee] = []
            return True
        return False
