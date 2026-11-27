"""Minimal Supabase client (PostgREST + Storage) using the service-role key. Server only."""

from __future__ import annotations

import json
from typing import Any

import httpx


class Supa:
    def __init__(self, url: str, key: str):
        self.url = url
        self.http = httpx.Client(
            timeout=30,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )

    # ---- PostgREST -------------------------------------------------------
    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        r = self.http.get(f"{self.url}/rest/v1/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, row: dict[str, Any] | list[dict[str, Any]]) -> None:
        r = self.http.post(f"{self.url}/rest/v1/{table}", json=row, headers={"Prefer": "return=minimal"})
        r.raise_for_status()

    def update(self, table: str, match: dict[str, str], patch: dict[str, Any]) -> None:
        r = self.http.patch(f"{self.url}/rest/v1/{table}", params=match, json=patch, headers={"Prefer": "return=minimal"})
        r.raise_for_status()

    def delete(self, table: str, match: dict[str, str]) -> None:
        r = self.http.delete(f"{self.url}/rest/v1/{table}", params=match)
        r.raise_for_status()

    def rpc(self, fn: str, args: dict[str, Any]) -> Any:
        r = self.http.post(f"{self.url}/rest/v1/rpc/{fn}", json=args)
        if r.status_code >= 400:
            raise RuntimeError(f"rpc {fn}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    # ---- Storage ---------------------------------------------------------
    def download(self, bucket: str, path: str) -> bytes:
        r = self.http.get(f"{self.url}/storage/v1/object/{bucket}/{path}")
        r.raise_for_status()
        return r.content

    def upload(self, bucket: str, path: str, data: bytes, content_type: str = "image/jpeg") -> None:
        r = self.http.post(
            f"{self.url}/storage/v1/object/{bucket}/{path}",
            content=data,
            headers={"Content-Type": content_type, "x-upsert": "true"},
        )
        r.raise_for_status()

    def remove(self, bucket: str, paths: list[str]) -> None:
        if not paths:
            return
        r = self.http.request("DELETE", f"{self.url}/storage/v1/object/{bucket}", content=json.dumps({"prefixes": paths}),
                              headers={"Content-Type": "application/json"})
        r.raise_for_status()


def vector_literal(v) -> str:
    """pgvector text format."""
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def parse_vector(s: str | list) -> list[float]:
    return s if isinstance(s, list) else json.loads(s)
