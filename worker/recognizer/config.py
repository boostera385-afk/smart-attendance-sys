"""Worker settings from environment variables (same names as the web app where shared)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or v == "":
        raise SystemExit(f"Missing environment variable {name}")
    return v


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_key: str
    ezviz_key: str
    ezviz_secret: str
    ezviz_base: str
    models_dir: Path
    match_threshold: float      # cosine similarity needed to accept a match (camera override wins)
    match_margin: float         # best must beat the next person by this much
    votes: int                  # agreeing frames needed …
    vote_window: float          # … within this many seconds
    sighting_interval: float    # min seconds between DB writes per person per camera
    min_face_px: int            # faces smaller than this (width) are ignored
    snapshot_interval: float    # seconds between captures in snapshot mode
    health_port: int

    @staticmethod
    def load() -> "Config":
        return Config(
            supabase_url=_env("NEXT_PUBLIC_SUPABASE_URL", os.environ.get("SUPABASE_URL")).rstrip("/"),
            supabase_key=_env("SUPABASE_SECRET_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
            ezviz_key=_env("EZVIZ_APP_KEY"),
            ezviz_secret=_env("EZVIZ_APP_SECRET"),
            ezviz_base=os.environ.get("EZVIZ_BASE_URL", "https://open.ezvizlife.com"),
            models_dir=Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parent.parent / "models")),
            match_threshold=float(os.environ.get("MATCH_THRESHOLD", "0.42")),
            match_margin=float(os.environ.get("MATCH_MARGIN", "0.05")),
            votes=int(os.environ.get("MATCH_VOTES", "2")),
            vote_window=float(os.environ.get("VOTE_WINDOW_SECONDS", "20")),
            sighting_interval=float(os.environ.get("SIGHTING_INTERVAL_SECONDS", "60")),
            min_face_px=int(os.environ.get("MIN_FACE_PX", "60")),
            snapshot_interval=float(os.environ.get("SNAPSHOT_INTERVAL_SECONDS", "3")),
            health_port=int(os.environ.get("HEALTH_PORT", "8080")),
        )
