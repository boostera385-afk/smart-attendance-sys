"""Recognition worker: EZVIZ cameras → face match → Supabase attendance.

Threads:
  sync        every 60 s  reload cameras, approved embeddings, settings; write camera heartbeats
  enrollment  every 15 s  turn uploaded face photos into embeddings
  camera ×N   continuous  read frames (HLS stream, snapshot fallback) → detect → embed → match → record_sighting
  cleanup     hourly      delete expired snapshots / unknown faces (no video is ever stored)
Health: GET :8080/ → 200 while the sync loop is alive (Vercel livenessProbe).
"""

from __future__ import annotations

import datetime as dt
import logging
import signal
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import cv2
import numpy as np

from .config import Config
from .ezviz import Ezviz, EzvizError
from .faces import FaceEngine, Gallery, Voter, decode_image
from .supa import Supa, parse_vector, vector_literal

log = logging.getLogger("worker")
shutdown = threading.Event()


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cameras: dict[str, dict] = {}
        self.gallery = Gallery()
        self.employee_dept: dict[str, str | None] = {}
        self.org_settings: dict[str, dict] = {}
        self.camera_health: dict[str, tuple[str, str | None]] = {}  # id → (status, error)
        self.last_sync = time.time()


class Worker:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.db = Supa(cfg.supabase_url, cfg.supabase_key)
        self.ez = Ezviz(cfg.ezviz_key, cfg.ezviz_secret, cfg.ezviz_base)
        self.engine = FaceEngine(cfg.models_dir)
        self.state = State()
        self.threads: dict[str, threading.Thread] = {}
        self.infer_lock = threading.Semaphore(2)  # cap concurrent ONNX runs on small instances

    # ------------------------------------------------------------------ sync
    def sync(self) -> None:
        cams = self.db.select("cameras", {
            "select": "id,organization_id,name,ezviz_serial,ezviz_channel,role,fps,match_threshold,department_id,connection,rtsp_url",
            "role": "neq.disabled",
        })
        emps = self.db.select("employees", {"select": "id,department_id", "status": "eq.active"})
        active = {e["id"] for e in emps}
        rows: list[tuple[str, list[float]]] = []
        offset = 0
        while True:
            page = self.db.select("face_embeddings", {
                "select": "employee_id,embedding", "approved": "eq.true", "offset": str(offset), "limit": "1000",
            })
            rows += [(r["employee_id"], parse_vector(r["embedding"])) for r in page if r["employee_id"] in active]
            if len(page) < 1000:
                break
            offset += 1000
        settings = self.db.select("settings", {"select": "organization_id,value", "key": "eq.recognition"})
        with self.state.lock:
            self.state.cameras = {c["id"]: c for c in cams}
            self.state.gallery.load(rows)
            self.state.employee_dept = {e["id"]: e["department_id"] for e in emps}
            self.state.org_settings = {s["organization_id"]: s["value"] or {} for s in settings}
            self.state.last_sync = time.time()
        # heartbeats
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        for cid, (status, err) in list(self.state.camera_health.items()):
            patch = {"status": status, "last_error": err}
            if status == "online":
                patch["last_seen_at"] = now
            try:
                self.db.update("cameras", {"id": f"eq.{cid}"}, patch)
            except Exception as e:  # noqa: BLE001
                log.warning("heartbeat %s: %s", cid, e)
        # start/stop camera threads
        for cid in self.state.cameras:
            t = self.threads.get(cid)
            if t is None or not t.is_alive():
                t = threading.Thread(target=self.camera_loop, args=(cid,), name=f"cam-{cid[:8]}", daemon=True)
                self.threads[cid] = t
                t.start()
        log.info("sync: %d cameras, %d face samples, %d active employees", len(cams), len(rows), len(active))

    # ------------------------------------------------------------ enrollment
    def enroll_pending(self) -> None:
        photos = self.db.select("face_photos", {
            "select": "id,employee_id,path", "status": "eq.pending", "order": "created_at", "limit": "20",
        })
        for p in photos:
            status, err, quality = "failed", None, None
            try:
                img = decode_image(self.db.download("faces", p["path"]))
                if img is None:
                    raise ValueError("Could not read this image")
                faces = self.engine.detect(img)
                if not faces:
                    raise ValueError("No face found — use a clear, front-facing photo")
                if len(faces) > 1 and faces[1].width > faces[0].width * 0.6:
                    raise ValueError("More than one face in the photo")
                f = faces[0]
                if f.width < 80:
                    raise ValueError("Face is too small — take the photo closer")
                if self.engine.sharpness(img, f) < 25:
                    raise ValueError("Photo is blurry")
                with self.infer_lock:
                    v = self.engine.embed(img, f)
                quality = f.score
                self.db.delete("face_embeddings", {"photo_id": f"eq.{p['id']}"})
                self.db.insert("face_embeddings", {
                    "employee_id": p["employee_id"], "embedding": vector_literal(v), "quality": quality,
                    "image_path": p["path"], "photo_id": p["id"], "approved": False, "model": "auraface-v1",
                })
                status = "processed"
            except Exception as e:  # noqa: BLE001
                err = str(e)[:200]
            self.db.update("face_photos", {"id": f"eq.{p['id']}"}, {
                "status": status, "error": err, "quality": quality,
                "processed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            })
            log.info("enrollment %s → %s %s", p["id"][:8], status, err or "")

    # --------------------------------------------------------------- cameras
    def frames(self, cam: dict):
        """Yields BGR frames at ~cam.fps. HLS stream first; EZVIZ snapshots if the stream can't be opened."""
        fps = max(0.2, float(cam.get("fps") or 2))
        stream_failures = 0
        while not shutdown.is_set() and cam["id"] in self.state.cameras:
            if stream_failures < 3:
                try:
                    url = cam["rtsp_url"] if cam.get("connection") != "ezviz_cloud" and cam.get("rtsp_url") else \
                        self.ez.hls_url(cam["ezviz_serial"], cam["ezviz_channel"])
                    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
                    if not cap.isOpened():
                        raise RuntimeError("stream did not open")
                    # EZVIZ starts the HLS stream on demand: the first segment can take 10–40 s
                    last = 0.0
                    got_frame = False
                    last_ok = time.time()
                    while not shutdown.is_set() and cam["id"] in self.state.cameras:
                        if not cap.grab():
                            if time.time() - last_ok > (15 if got_frame else 60):
                                break
                            time.sleep(0.2)
                            continue
                        last_ok = time.time()
                        if not got_frame:
                            got_frame = True
                            stream_failures = 0
                            self.state.camera_health[cam["id"]] = ("online", None)
                            log.info("%s: live stream receiving frames", cam["name"])
                        if last_ok - last >= 1 / fps:
                            ok, frame = cap.retrieve()
                            if ok:
                                last = last_ok
                                yield frame
                    cap.release()
                    if not got_frame:
                        raise RuntimeError("stream opened but sent no video for 60 s")
                    continue
                except EzvizError as e:
                    self.state.camera_health[cam["id"]] = ("error", str(e))
                    stream_failures += 1
                    log.warning("%s stream: %s", cam["name"], e)
                except Exception as e:  # noqa: BLE001
                    stream_failures += 1
                    log.warning("%s stream: %s", cam["name"], e)
                if stream_failures < 3:
                    shutdown.wait(5)
                    continue
                log.info("%s: using snapshot mode", cam["name"])
            # snapshot fallback (retry the stream every 10 min)
            started = time.time()
            while not shutdown.is_set() and time.time() - started < 600 and cam["id"] in self.state.cameras:
                try:
                    img = decode_image(self.ez.capture(cam["ezviz_serial"], cam["ezviz_channel"]))
                    self.state.camera_health[cam["id"]] = ("online", None)
                    if img is not None:
                        yield img
                except Exception as e:  # noqa: BLE001
                    self.state.camera_health[cam["id"]] = ("offline" if "offline" in str(e).lower() else "error", str(e)[:200])
                    shutdown.wait(15)
                shutdown.wait(self.cfg.snapshot_interval)
            stream_failures = 0

    def camera_loop(self, cid: str) -> None:
        cam = self.state.cameras.get(cid)
        if not cam:
            return
        log.info("camera %s (%s) started", cam["name"], cam["role"])
        voter = Voter(self.cfg.votes, self.cfg.vote_window)
        last_write: dict[str, float] = {}
        unknown_recent: list[tuple[float, np.ndarray]] = []
        try:
            for frame in self.frames(cam):
                cam = self.state.cameras.get(cid)
                if cam is None:
                    break
                self.process_frame(cam, frame, voter, last_write, unknown_recent)
        except Exception:  # noqa: BLE001
            log.exception("camera %s crashed; restarts on next sync", cid)
            self.state.camera_health[cid] = ("error", "worker error, restarting")

    def process_frame(self, cam: dict, frame: np.ndarray, voter: Voter, last_write: dict[str, float],
                      unknown_recent: list[tuple[float, np.ndarray]]) -> None:
        settings = self.state.org_settings.get(cam["organization_id"], {})
        threshold = float(cam.get("match_threshold") or settings.get("threshold") or self.cfg.match_threshold)
        faces = [f for f in self.engine.detect(frame) if f.width >= self.cfg.min_face_px][:5]
        if not faces:
            return
        now = time.time()
        allowed = None
        if cam.get("department_id"):
            allowed = {e for e, d in self.state.employee_dept.items() if d == cam["department_id"]}
        for f in faces:
            with self.infer_lock:
                v = self.engine.embed(frame, f)
            with self.state.lock:
                emp, score, second = self.state.gallery.match(v, allowed)
            if emp and score >= threshold and score - second >= self.cfg.match_margin:
                if voter.add(emp, now) and now - last_write.get(emp, 0) >= self.cfg.sighting_interval:
                    last_write[emp] = now
                    self.record(cam, emp, score, frame, f)
            elif score < threshold - 0.08 and f.width >= self.cfg.min_face_px * 1.3 and f.score >= 0.9:
                self.unknown(cam, frame, f, v, emp, score, unknown_recent)

    def record(self, cam: dict, emp: str, score: float, frame: np.ndarray, face) -> None:
        path = f"{cam['organization_id']}/{dt.date.today():%Y/%m/%d}/{uuid.uuid4()}.jpg"
        try:
            self.db.upload("snapshots", path, self.engine.crop_jpeg(frame, face))
        except Exception as e:  # noqa: BLE001
            log.warning("snapshot upload: %s", e)
            path = None
        try:
            res = self.db.rpc("record_sighting", {
                "p_camera": cam["id"], "p_employee": emp, "p_confidence": round(score, 3), "p_snapshot": path,
            }) or {}
            action = res.get("action")
            kept = ("check_in", "check_out", "shadow_check_in")  # shadow = camera test mode (portal is official)
            if path and action not in kept:
                self.db.remove("snapshots", [path])  # plain sightings keep no image
            if action in kept:
                log.info("%s: %s %s (%.2f)", cam["name"], action, emp[:8], score)
        except Exception as e:  # noqa: BLE001
            log.warning("record_sighting: %s", e)

    def unknown(self, cam: dict, frame: np.ndarray, face, v: np.ndarray, best: str | None, score: float,
                recent: list[tuple[float, np.ndarray]]) -> None:
        now = time.time()
        recent[:] = [(t, e) for t, e in recent if now - t < 600]
        if any(float(e @ v) > 0.5 for _, e in recent):
            return  # same stranger within 10 min
        recent.append((now, v))
        path = f"{cam['organization_id']}/unknown/{dt.date.today():%Y/%m/%d}/{uuid.uuid4()}.jpg"
        try:
            self.db.upload("snapshots", path, self.engine.crop_jpeg(frame, face))
            self.db.insert("unknown_faces", {
                "organization_id": cam["organization_id"], "camera_id": cam["id"], "snapshot_path": path,
                "embedding": vector_literal(v), "best_match_employee_id": best, "best_match_score": round(score, 3),
            })
        except Exception as e:  # noqa: BLE001
            log.warning("unknown face: %s", e)

    # --------------------------------------------------------------- cleanup
    def cleanup(self) -> None:
        """Retention (MASTER_PLAN §12): event snapshots 30 days, unknown faces 7 days."""
        cutoff30 = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)).isoformat()
        cutoff7 = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)).isoformat()
        old = self.db.select("attendance_events", {
            "select": "id,snapshot_path", "snapshot_path": "not.is.null", "occurred_at": f"lt.{cutoff30}", "limit": "500",
        })
        if old:
            self.db.remove("snapshots", [o["snapshot_path"] for o in old])
            self.db.update("attendance_events", {"id": f"in.({','.join(str(o['id']) for o in old)})"}, {"snapshot_path": None})
        unk = self.db.select("unknown_faces", {
            "select": "id,snapshot_path", "occurred_at": f"lt.{cutoff7}", "status": "neq.assigned", "limit": "500",
        })
        if unk:
            self.db.remove("snapshots", [u["snapshot_path"] for u in unk if u["snapshot_path"]])
            self.db.delete("unknown_faces", {"id": f"in.({','.join(u['id'] for u in unk)})"})
        if old or unk:
            log.info("cleanup: %d snapshots, %d unknown faces", len(old), len(unk))

    # ------------------------------------------------------------------ run
    def every(self, seconds: float, fn, name: str) -> None:
        def loop():
            while not shutdown.is_set():
                try:
                    fn()
                except Exception:  # noqa: BLE001
                    log.exception("%s failed", name)
                shutdown.wait(seconds)
        threading.Thread(target=loop, name=name, daemon=True).start()

    def serve_health(self) -> None:
        state = self.state

        class H(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                ok = time.time() - state.last_sync < 300
                self.send_response(200 if ok else 503)
                self.end_headers()
                self.wfile.write(b"ok" if ok else b"stale")

            def log_message(self, *a):  # silence access logs
                pass

        srv = HTTPServer(("0.0.0.0", self.cfg.health_port), H)
        threading.Thread(target=srv.serve_forever, name="health", daemon=True).start()

    def run(self) -> None:
        self.serve_health()
        self.every(60, self.sync, "sync")
        self.every(15, self.enroll_pending, "enrollment")
        self.every(3600, self.cleanup, "cleanup")
        shutdown.wait()
        log.info("shutting down")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(threadName)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per HTTP call is too noisy
    signal.signal(signal.SIGTERM, lambda *_: shutdown.set())
    signal.signal(signal.SIGINT, lambda *_: shutdown.set())
    Worker(Config.load()).run()


if __name__ == "__main__":
    main()
