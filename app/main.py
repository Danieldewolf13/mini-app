from __future__ import annotations

from datetime import date as current_date
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .repository import build_dashboard_payload, build_job_detail_payload
from .services.planning_service import get_planning_data


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


@app.get("/dispatcher/planning", response_class=HTMLResponse)
async def dispatcher_planning(request: Request):
    return templates.TemplateResponse(
        "dispatcher/planning.html",
        {
            "request": request,
            "page_title": "Planning",
            "billit_base_url": settings.billit_base_url,
            "planning_date": current_date.today().isoformat(),
            "planning_view": "day",
            "jobs": [],
            "appointments": [],
            "technicians": [],
        },
    )


@app.get("/api/dashboard")
async def dashboard_api():
    payload = load_dashboard_payload()
    status_code = 503 if payload.get("db_error") else 200
    return JSONResponse(payload, status_code=status_code)


@app.get("/api/planning")
async def planning_api(date: str | None = None, view: str | None = None):
    try:
        payload = get_planning_data(date, view)
        return JSONResponse(payload)
    except Exception as exc:
        return JSONResponse(
            {
                "date": date or "",
                "view": view or "day",
                "technicians": [],
                "jobs": [],
                "error": str(exc),
            },
            status_code=503,
        )


@app.get("/api/jobs/{job_id}")
async def job_detail_api(job_id: int):
    payload = build_job_detail_payload(job_id)
    if not payload:
        return JSONResponse({"error": "Job not found"}, status_code=404)
    return JSONResponse(payload)


@app.get("/health")
async def health():
    return {"ok": True, "app": settings.app_name}
