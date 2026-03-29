from __future__ import annotations

from datetime import date, datetime, timedelta

from ..repository import fetch_planning_jobs, fetch_planning_technicians


def _normalize_date_input(raw: str | None) -> str:
    value = str(raw or "").strip()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except Exception:
        return date.today().isoformat()


def _add_days(date_string: str, amount: int) -> str:
    parsed = datetime.strptime(date_string, "%Y-%m-%d").date()
    return (parsed + timedelta(days=amount)).isoformat()


def _extract_city(address: str | None) -> str:
    raw = str(address or "").strip()
    if not raw:
        return ""

    parts = [part.strip() for part in raw.split(",") if part.strip()]
    tail = parts[-1] if parts else raw
    if tail.lower() == "belgium" and len(parts) > 1:
        tail = parts[-2]
    if len(tail) >= 5 and tail[:4].isdigit():
        return tail[5:].strip()
    return tail


def _derive_region(address: str | None) -> str:
    raw = str(address or "")
    digits = "".join(ch for ch in raw if ch.isdigit())
    postal_code = None
    for index in range(0, max(len(digits) - 3, 0)):
        chunk = digits[index : index + 4]
        if len(chunk) == 4:
            postal_code = int(chunk)
            break

    if postal_code is None:
        return _extract_city(address) or "Onbekend"

    if 1000 <= postal_code <= 1299:
        return "Brussels"
    if 1300 <= postal_code <= 1499:
        return "Walloon Brabant"
    if 1500 <= postal_code <= 1999:
        return "Vlaams-Brabant"
    if 2000 <= postal_code <= 2999:
        return "Antwerp"
    if 3000 <= postal_code <= 3499:
        return "Vlaams-Brabant"
    if 3500 <= postal_code <= 3999:
        return "Limburg"
    if 4000 <= postal_code <= 4999:
        return "Liege"
    if 5000 <= postal_code <= 5999:
        return "Namur"
    if 6000 <= postal_code <= 7999:
        return "Hainaut"
    if 8000 <= postal_code <= 8999:
        return "West Flanders"
    if 9000 <= postal_code <= 9999:
        return "East Flanders"
    return _extract_city(address) or "Onbekend"


def _build_jobs(rows: list[dict], selected_date: str) -> list[dict]:
    now = datetime.now()
    jobs: list[dict] = []

    for row in rows:
        start = row.get("scheduled_start")
        end = row.get("scheduled_end") or (start + timedelta(hours=1) if start else None)
        status = str(row.get("status") or "").strip() or "unassigned"
        urgent = "dring" in str(row.get("category") or "").lower() or status == "on_the_way"
        overdue = bool(start and start < now and status not in {"done", "completed", "cancelled"})

        jobs.append(
            {
                "id": row.get("job_id"),
                "client": row.get("client_name") or "-",
                "city": _extract_city(row.get("address_raw")),
                "region": _derive_region(row.get("address_raw")),
                "start": start.strftime("%Y-%m-%dT%H:%M:%S") if start else "",
                "end": end.strftime("%Y-%m-%dT%H:%M:%S") if end else "",
                "technician_id": row.get("technician_id") or "unassigned",
                "status": status,
                "urgent": urgent,
                "overdue": overdue,
                "date": selected_date,
            }
        )

    return jobs


def _build_technicians(rows: list[dict], jobs: list[dict]) -> list[dict]:
    usage: dict[str, int] = {}
    for job in jobs:
        technician_id = str(job.get("technician_id"))
        usage[technician_id] = usage.get(technician_id, 0) + 1

    technicians = []
    for row in rows:
        tech_id = row.get("tg_id")
        active_jobs = usage.get(str(tech_id), 0)
        region = next((job["region"] for job in jobs if str(job.get("technician_id")) == str(tech_id)), "General")
        technicians.append(
            {
                "id": tech_id,
                "name": row.get("full_name") or "-",
                "status": "busy" if active_jobs else "available",
                "region": region,
            }
        )

    if any(job.get("technician_id") == "unassigned" for job in jobs):
        technicians.append(
            {
                "id": "unassigned",
                "name": "Unassigned",
                "status": "attention",
                "region": "All",
            }
        )

    return technicians


def _build_week_overview(selected_date: str, technicians: list[dict], jobs: list[dict]) -> dict:
    end_date = _add_days(selected_date, 6)
    totals = []

    for technician in technicians:
        tech_id = str(technician.get("id"))
        totals.append(
            {
                "technician_id": technician.get("id"),
                "name": technician.get("name"),
                "jobs": sum(1 for job in jobs if str(job.get("technician_id")) == tech_id),
            }
        )

    return {
        "message": f"Week view toont voorlopig een lichte overview van {selected_date} tot {end_date}.",
        "totals": totals,
    }


def get_planning_data(date_input: str | None, view_input: str | None):
    selected_date = _normalize_date_input(date_input)
    selected_view = "week" if view_input == "week" else "day"
    end_date = _add_days(selected_date, 6) if selected_view == "week" else selected_date

    technicians_rows = fetch_planning_technicians()
    jobs_rows = fetch_planning_jobs(selected_date, end_date)

    jobs = _build_jobs(jobs_rows, selected_date)
    technicians = _build_technicians(technicians_rows, jobs)

    return {
        "date": selected_date,
        "view": selected_view,
        "technicians": technicians,
        "jobs": jobs,
        "week": _build_week_overview(selected_date, technicians, jobs) if selected_view == "week" else None,
    }
