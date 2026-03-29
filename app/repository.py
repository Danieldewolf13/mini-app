from __future__ import annotations

from datetime import datetime

from .db import db_cursor
from .shared import (
    classify_group,
    format_afspraak_type,
    format_dt,
    format_payment_method,
    format_payment_status,
    format_status,
    is_internal_receiver,
)


ACTIVE_JOB_SELECT = """
    SELECT
        c.id,
        c.category,
        c.problem_type,
        c.work_type,
        c.address_raw,
        c.status,
        c.payment_status,
        c.group_chat_id,
        c.created_at,
        cl.client_name,
        cl.phone,
        u.full_name AS technician_name,
        u.tech_key,
        u.tg_id AS technician_id,
        p.payment_method,
        p.payment_method_code,
        p.payment_type,
        p.invoice_number,
        p.amount_excl_vat,
        p.receiver_scope,
        p.created_by AS payment_created_by
    FROM cards c
    LEFT JOIN clients cl ON c.client_id = cl.id
    LEFT JOIN users u ON c.assigned_to = u.tg_id
    LEFT JOIN (
        SELECT p1.*
        FROM payments p1
        INNER JOIN (
            SELECT card_id, MAX(created_at) AS max_created_at
            FROM payments
            GROUP BY card_id
        ) latest
          ON latest.card_id = p1.card_id
         AND latest.max_created_at = p1.created_at
    ) p ON p.card_id = c.id
"""


def fetch_active_jobs():
    query = f"""
        {ACTIVE_JOB_SELECT}
        WHERE c.status NOT IN ('completed', 'cancelled')
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 250
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def fetch_job_by_id(job_id: int):
    query = f"""
        {ACTIVE_JOB_SELECT}
        WHERE c.id = {int(job_id)}
        LIMIT 1
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows[0] if rows else None


def fetch_job_appointments(job_id: int):
    query = f"""
        SELECT
            scheduled_at,
            afspraak_type,
            status,
            created_at
        FROM afspraak
        WHERE card_id = {int(job_id)}
        ORDER BY created_at DESC
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def fetch_upcoming_appointments():
    query = """
        SELECT
            c.id,
            c.address_raw,
            cl.client_name,
            u.full_name AS technician_name,
            a.scheduled_at,
            a.afspraak_type
        FROM cards c
        LEFT JOIN clients cl ON c.client_id = cl.id
        LEFT JOIN users u ON c.assigned_to = u.tg_id
        INNER JOIN (
            SELECT a1.*
            FROM afspraak a1
            INNER JOIN (
                SELECT card_id, MAX(created_at) AS max_created_at
                FROM afspraak
                WHERE status = 'scheduled'
                GROUP BY card_id
            ) latest
              ON latest.card_id = a1.card_id
             AND latest.max_created_at = a1.created_at
            WHERE a1.status = 'scheduled'
        ) a ON a.card_id = c.id
        WHERE a.scheduled_at >= CURDATE()
          AND a.scheduled_at < DATE_ADD(CURDATE(), INTERVAL 2 DAY)
          AND c.status NOT IN ('completed', 'cancelled', 'done')
        ORDER BY a.scheduled_at ASC
        LIMIT 100
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def fetch_technician_summary():
    query = """
        SELECT
            u.tg_id,
            u.full_name,
            u.tech_key,
            u.role,
            COUNT(c.id) AS active_jobs
        FROM users u
        LEFT JOIN cards c
          ON c.assigned_to = u.tg_id
         AND c.status NOT IN ('completed', 'cancelled')
        WHERE u.is_active = 1
        GROUP BY u.tg_id, u.full_name, u.tech_key, u.role
        ORDER BY u.full_name ASC
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def fetch_planning_technicians():
    query = """
        SELECT
            u.tg_id,
            u.full_name,
            u.tech_key,
            u.role
        FROM users u
        WHERE u.is_active = 1
        ORDER BY u.full_name ASC
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def fetch_planning_jobs(start_date: str, end_date: str):
    query = f"""
        SELECT
            c.id AS job_id,
            c.category,
            c.problem_type,
            c.work_type,
            c.address_raw,
            c.status,
            c.created_at,
            cl.client_name,
            u.tg_id AS technician_id,
            u.full_name AS technician_name,
            u.role AS technician_status,
            a.scheduled_at AS scheduled_start,
            DATE_ADD(a.scheduled_at, INTERVAL 60 MINUTE) AS scheduled_end
        FROM afspraak a
        INNER JOIN cards c ON c.id = a.card_id
        LEFT JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN users u ON u.tg_id = c.assigned_to
        WHERE a.status = 'scheduled'
          AND a.scheduled_at >= '{start_date} 00:00:00'
          AND a.scheduled_at < DATE_ADD('{end_date} 00:00:00', INTERVAL 1 DAY)
          AND c.status NOT IN ('completed', 'cancelled')
        ORDER BY a.scheduled_at ASC, c.id ASC
    """
    with db_cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall() or []
    return rows


def _format_amount(value):
    if value is None:
        return "-"
    try:
        return f"EUR {float(value or 0):.2f}"
    except Exception:
        return str(value)


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


def build_dashboard_payload():
    jobs = fetch_active_jobs()
    appointments = fetch_upcoming_appointments()
    technicians = fetch_technician_summary()

    status_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    regular_jobs = 0
    corp_jobs = 0

    for job in jobs:
        status = (job.get("status") or "unknown").strip()
        category = (job.get("category") or "Onbekend").strip()
        status_counts[status] = status_counts.get(status, 0) + 1
        category_counts[category] = category_counts.get(category, 0) + 1

        group_type, group_label = classify_group(job.get("group_chat_id"))
        job["group_type"] = group_type
        job["group_label"] = group_label
        if group_type == "regular":
            regular_jobs += 1
        elif group_type == "corp":
            corp_jobs += 1
        job["created_at_label"] = format_dt(job.get("created_at"))
        job["detail_text"] = (job.get("problem_type") or job.get("work_type") or "").strip()
        job["status_label"] = format_status(job.get("status"))
        job["payment_status_label"] = format_payment_status(job.get("payment_status"))
        job["payment_method_label"] = format_payment_method(job.get("payment_method_code") or job.get("payment_method"))
        job["payment_receiver_kind"] = "intern" if is_internal_receiver(job.get("payment_created_by")) else "partner"
        if job.get("amount_excl_vat") is not None:
            try:
                job["amount_excl_vat_label"] = f"EUR {float(job.get('amount_excl_vat') or 0):.2f}"
            except Exception:
                job["amount_excl_vat_label"] = str(job.get("amount_excl_vat"))
        else:
            job["amount_excl_vat_label"] = "—"

    for row in appointments:
        row["scheduled_at_label"] = format_dt(row.get("scheduled_at"))
        row["afspraak_type_label"] = format_afspraak_type(row.get("afspraak_type"))

    return {
        "jobs": jobs,
        "appointments": appointments,
        "technicians": technicians,
        "status_counts": status_counts,
        "category_counts": category_counts,
        "regular_jobs": regular_jobs,
        "corp_jobs": corp_jobs,
        "generated_at": datetime.now().strftime("%d/%m/%Y %H:%M"),
    }


def build_job_detail_payload(job_id: int):
    job = fetch_job_by_id(job_id)
    if not job:
        return None

    appointments = fetch_job_appointments(job_id)
    latest_appointment = appointments[0] if appointments else None
    group_type, group_label = classify_group(job.get("group_chat_id"))

    return {
        "id": job["id"],
        "client": job.get("client_name") or "-",
        "phone": job.get("phone") or "-",
        "address": job.get("address_raw") or "-",
        "city": _extract_city(job.get("address_raw")),
        "category": job.get("category") or "Onbekend",
        "status": (job.get("status") or "unknown").strip(),
        "status_label": format_status(job.get("status")),
        "technician": job.get("technician_name") or "Niet toegewezen",
        "created_at": format_dt(job.get("created_at")),
        "problem": job.get("problem_type") or "-",
        "work_type": job.get("work_type") or "-",
        "group": group_label,
        "next_appointment": {
            "scheduled_at": format_dt(latest_appointment.get("scheduled_at")),
            "type": format_afspraak_type(latest_appointment.get("afspraak_type")),
            "status": latest_appointment.get("status") or "-",
        }
        if latest_appointment
        else None,
        "documents": [],
        "finance": {
            "status": format_payment_status(job.get("payment_status")),
            "method": format_payment_method(job.get("payment_method_code") or job.get("payment_method")),
            "invoice": job.get("invoice_number") or "-",
            "amount_excl_vat": _format_amount(job.get("amount_excl_vat")),
            "receiver": "intern" if is_internal_receiver(job.get("payment_created_by")) else "partner",
        },
        "group_type": group_type,
    }
