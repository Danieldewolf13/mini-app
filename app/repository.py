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


def fetch_active_jobs():
    query = """
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
        WHERE c.status NOT IN ('completed', 'cancelled')
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 250
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
