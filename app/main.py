from __future__ import annotations

import secrets
from datetime import date as current_date
from pathlib import Path

from fastapi import FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from .config import settings
from .repository import build_dashboard_payload, build_job_detail_payload
from .services.billit_service import BillitApiError, BillitConfigurationError, create_invoice_order
from .services.planning_service import get_planning_data


BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title=settings.app_name)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


class BillitOrderRequest(BaseModel):
    opdracht_id: str = Field(min_length=1, max_length=100)
    customer_name: str = Field(min_length=1, max_length=250)
    customer_external_id: str | None = None
    vat_number: str | None = None
    email: str | None = None
    phone: str | None = None
    street: str | None = None
    postal_code: str | None = None
    city: str | None = None
    country_code: str = "BE"
    description: str | None = None
    amount_excl_vat: float = Field(gt=0)
    vat_percentage: float = Field(ge=0, le=100)
    payment_term_days: int = Field(default=14, ge=0, le=365)


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


def _billit_authorized(authorization: str | None) -> bool:
    expected = settings.billit_webhook_token
    if not expected or not authorization or not authorization.startswith("Bearer "):
        return False
    supplied = authorization.removeprefix("Bearer ").strip()
    return secrets.compare_digest(supplied, expected)


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


@app.post("/billit/order")
async def billit_order(
    body: BillitOrderRequest,
    authorization: str | None = Header(default=None),
):
    if not _billit_authorized(authorization):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    try:
        result = create_invoice_order(body.model_dump())
        return {
            "ok": True,
            "opdracht_id": body.opdracht_id,
            "billit_order_id": result.order_id,
            "billit_customer_id": result.customer_id,
            "environment": "sandbox",
        }
    except BillitConfigurationError as exc:
        return JSONResponse({"error": str(exc)}, status_code=503)
    except BillitApiError as exc:
        response = {"error": str(exc)}
        if exc.response_body:
            response["billit_response"] = exc.response_body[:2000]
        return JSONResponse(response, status_code=exc.status_code)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "app": settings.app_name,
        "billit_poc": {
            "api_url": settings.billit_api_url,
            "configured": bool(settings.billit_api_key and settings.billit_party_id),
            "auth_configured": bool(settings.billit_webhook_token),
        },
    }
