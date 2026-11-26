"""Phase 0 probe: verify what the EZVIZ Open Platform API can do with our cameras.

Standard library only. Usage (PowerShell):
    $env:EZVIZ_APP_KEY = "..."; $env:EZVIZ_APP_SECRET = "..."
    python worker/ezviz_probe.py                     # token, devices, capabilities, snapshots, live URLs
    python worker/ezviz_probe.py --voice hello.wav --serial ABC123   # also test camera voice playback

Writes snapshots to worker/probe_output/ and a JSON report to worker/probe_output/report.json.
Endpoints marked UNVERIFIED come from third-party docs and are exactly what this probe checks.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE_URL = os.environ.get("EZVIZ_BASE_URL", "https://open.ezvizlife.com")
OUT_DIR = Path(__file__).parent / "probe_output"
LIVE_PROTOCOLS = {1: "ezopen", 2: "hls", 3: "rtmp", 4: "flv"}


def post_form(url: str, fields: dict) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    return _send(req)


def post_multipart(url: str, fields: dict, file_field: str, file_path: Path) -> dict:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
        + file_path.read_bytes()
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(url, data=b"".join(parts), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    return _send(req)


def _send(req: urllib.request.Request) -> dict:
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"code": str(e.code), "msg": e.read().decode(errors="replace")[:300]}
    except Exception as e:  # network errors are results too
        return {"code": "EXC", "msg": repr(e)}


def ok(resp: dict) -> bool:
    return str(resp.get("code")) == "200"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", type=Path, help="audio file to upload and play on a camera")
    ap.add_argument("--serial", help="device serial for the voice test (default: first device)")
    ap.add_argument("--no-snapshots", action="store_true")
    args = ap.parse_args()

    key, secret = os.environ.get("EZVIZ_APP_KEY"), os.environ.get("EZVIZ_APP_SECRET")
    if not key or not secret:
        print("Set EZVIZ_APP_KEY and EZVIZ_APP_SECRET environment variables first.")
        return 2

    OUT_DIR.mkdir(exist_ok=True)
    report: dict = {"base_url": BASE_URL, "devices": []}

    # 1. Token
    tok = post_form(f"{BASE_URL}/api/lapp/token/get", {"appKey": key, "appSecret": secret})
    if not ok(tok):
        print(f"[FAIL] token: {tok.get('code')} {tok.get('msg')}")
        return 1
    token = tok["data"]["accessToken"]
    api = tok["data"].get("areaDomain") or BASE_URL
    report["area_domain"] = api
    print(f"[OK]   token  (area domain: {api})")

    # 2. Devices + channels
    devs = post_form(f"{api}/api/lapp/device/list", {"accessToken": token, "pageStart": 0, "pageSize": 50})
    if not ok(devs):
        print(f"[FAIL] device list: {devs.get('code')} {devs.get('msg')}")
        return 1
    cams = post_form(f"{api}/api/lapp/camera/list", {"accessToken": token, "pageStart": 0, "pageSize": 50})
    channels = (cams.get("data") or []) if ok(cams) else []
    print(f"[OK]   {len(devs.get('data') or [])} devices, {len(channels)} channels")

    for d in devs.get("data") or []:
        serial = d.get("deviceSerial")
        entry = {
            "serial": serial,
            "name": d.get("deviceName"),
            "model": d.get("model"),
            "online": d.get("status") == 1,
        }

        # 3. Capabilities (PTZ, talk/voice, etc.)
        cap = post_form(f"{api}/api/lapp/device/capacity", {"accessToken": token, "deviceSerial": serial})
        entry["capacity"] = cap.get("data") if ok(cap) else f"ERR {cap.get('code')} {cap.get('msg')}"

        # 4. Snapshot
        if not args.no_snapshots and entry["online"]:
            snap = post_form(
                f"{api}/api/lapp/device/capture",
                {"accessToken": token, "deviceSerial": serial, "channelNo": 1},
            )
            if ok(snap):
                pic_url = snap["data"]["picUrl"]
                path = OUT_DIR / f"{serial}.jpg"
                try:
                    urllib.request.urlretrieve(pic_url, path)
                    entry["snapshot"] = str(path)
                except Exception as e:
                    entry["snapshot"] = f"download failed: {e!r}"
            else:
                entry["snapshot"] = f"ERR {snap.get('code')} {snap.get('msg')}"

        # 5. Live stream addresses per protocol
        entry["live"] = {}
        if entry["online"]:
            for proto, name in LIVE_PROTOCOLS.items():
                live = post_form(
                    f"{api}/api/lapp/v2/live/address/get",
                    {"accessToken": token, "deviceSerial": serial, "channelNo": 1, "protocol": proto, "quality": 1},
                )
                entry["live"][name] = (
                    "OK" if ok(live) else f"ERR {live.get('code')} {live.get('msg')}"
                )

        status = "online " if entry["online"] else "OFFLINE"
        print(f"  - {status} {entry['name']!s:<22} {entry['model']!s:<20} {serial}  "
              f"snapshot={'ok' if str(entry.get('snapshot','')).endswith('.jpg') else entry.get('snapshot','-')}  "
              f"live={entry['live']}")
        report["devices"].append(entry)

    # 6. Voice test (UNVERIFIED endpoints)
    if args.voice:
        serial = args.serial or next((d["serial"] for d in report["devices"] if d["online"]), None)
        if not serial:
            print("[SKIP] voice: no online device")
        else:
            up = post_multipart(
                f"{api}/api/lapp/voice/upload",
                {"accessToken": token, "voiceName": args.voice.stem},
                "voiceFile",
                args.voice,
            )
            report["voice_upload"] = up
            if ok(up):
                file_url = (up.get("data") or {}).get("url") or (up.get("data") or {}).get("fileUrl")
                send = post_form(
                    f"{api}/api/lapp/voice/send",
                    {"accessToken": token, "deviceSerial": serial, "channelNo": 1, "fileUrl": file_url},
                )
                report["voice_send"] = send
                print(f"[{'OK' if ok(send) else 'FAIL'}]  voice send to {serial}: {send.get('code')} {send.get('msg')}"
                      "  (did the camera play the sound?)")
            else:
                print(f"[FAIL] voice upload: {up.get('code')} {up.get('msg')}")

    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nReport: {OUT_DIR / 'report.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
