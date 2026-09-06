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
    billit_api_url: str = os.getenv("BILLIT_API_URL", "https://api.sandbox.billit.be")
    billit_api_key: str | None = os.getenv("BILLIT_API_KEY")
    billit_party_id: str | None = os.getenv("BILLIT_PARTY_ID")
    billit_webhook_token: str | None = os.getenv("BILLIT_WEBHOOK_TOKEN")


settings = Settings()
