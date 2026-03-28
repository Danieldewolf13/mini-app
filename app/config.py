from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "mini app"
    db_host: str | None = os.getenv("MINI_APP_DB_HOST")
    db_user: str | None = os.getenv("MINI_APP_DB_USER")
    db_pass: str | None = os.getenv("MINI_APP_DB_PASS")
    db_name: str | None = os.getenv("MINI_APP_DB_NAME")
    billit_base_url: str = os.getenv("BILLIT_BASE_URL", "https://app.billit.eu")


settings = Settings()
