from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .repository import build_dashboard_payload


BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title=settings.app_name)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


def empty_dashboard_payload(error_message: str | None = None):
    return {
        "jobs": [],
        "appointments": [],
        "technicians": [],
        "status_counts": {},
        "category_counts": {},
        "regular_jobs": 0,
        "corp_jobs": 0,
        "generated_at": "nog niet beschikbaar",
        "db_error": error_message,
    }


def load_dashboard_payload():
    try:
        payload = build_dashboard_payload()
        payload["db_error"] = None
        return payload
    except Exception as exc:
        return empty_dashboard_payload(str(exc))


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    payload = load_dashboard_payload()
    return templates.TemplateResponse(
        "dispatcher_dashboard.html",
        {
            "request": request,
            "page_title": "Dispatcher dashboard",
            "billit_base_url": settings.billit_base_url,
            **payload,
        },
    )


@app.get("/dispatcher", response_class=HTMLResponse)
async def dispatcher_dashboard(request: Request):
    payload = load_dashboard_payload()
    return templates.TemplateResponse(
        "dispatcher_dashboard.html",
        {
            "request": request,
            "page_title": "Dispatcher dashboard",
            "billit_base_url": settings.billit_base_url,
            **payload,
        },
    )


@app.get("/api/dashboard")
async def dashboard_api():
    payload = load_dashboard_payload()
    status_code = 503 if payload.get("db_error") else 200
    return JSONResponse(payload, status_code=status_code)


@app.get("/health")
async def health():
    return {"ok": True, "app": settings.app_name}
