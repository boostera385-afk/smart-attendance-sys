"""EZVIZ Open Platform: token, live stream address, snapshot capture."""

from __future__ import annotations

import threading
import time

import httpx


class EzvizError(RuntimeError):
    def __init__(self, code: str, msg: str):
        self.code = code
        super().__init__("Video encryption is on — turn it off in the EZVIZ app" if code == "60019" else f"EZVIZ {code}: {msg}")


class Ezviz:
    def __init__(self, key: str, secret: str, base: str):
        self.key, self.secret, self.base = key, secret, base
        self.http = httpx.Client(timeout=20)
        self._token: str | None = None
        self._domain = base
        self._expires = 0.0
        self._lock = threading.Lock()

    def _post(self, url: str, fields: dict) -> dict:
        r = self.http.post(url, data=fields)
        r.raise_for_status()
        j = r.json()
        if str(j.get("code")) != "200":
            raise EzvizError(str(j.get("code")), str(j.get("msg")))
        return j.get("data") or {}

    def token(self) -> tuple[str, str]:
        with self._lock:
            if not self._token or self._expires - time.time() < 3600:
                d = self._post(f"{self.base}/api/lapp/token/get", {"appKey": self.key, "appSecret": self.secret})
                self._token = d["accessToken"]
                self._domain = d.get("areaDomain") or self.base
                self._expires = d.get("expireTime", 0) / 1000 or time.time() + 6 * 86400
            return self._token, self._domain

    def call(self, path: str, **fields) -> dict:
        tok, dom = self.token()
        try:
            return self._post(f"{dom}{path}", {"accessToken": tok, **fields})
        except EzvizError as e:
            if e.code in ("10001", "10002"):
                with self._lock:
                    self._token = None
                tok, dom = self.token()
                return self._post(f"{dom}{path}", {"accessToken": tok, **fields})
            raise

    def hls_url(self, serial: str, channel: int) -> str:
        d = self.call("/api/lapp/v2/live/address/get", deviceSerial=serial, channelNo=channel, protocol=2, quality=1,
                      expireTime=86400)
        return d["url"]

    def capture(self, serial: str, channel: int) -> bytes:
        d = self.call("/api/lapp/device/capture", deviceSerial=serial, channelNo=channel)
        r = self.http.get(d["picUrl"])
        r.raise_for_status()
        return r.content
