from __future__ import annotations

from datetime import datetime


INTERNAL_PAYMENT_RECEIVER_IDS = {457141175, 7909226479}

PAYMENT_CAPTURE_GROUP_IDS = {
    "-1002299448091": "APTI",
    "-1002276060500": "ARBI",
    "-1001562342633": "DAN",
    "-1002455598483": "ISA",
    "-1002340152626": "MANS",
    "-1002397008426": "RAS",
}

CORP_CHATS = {
    "-1002649403969": "RALOCKS",
    "-1003251768093": "SECURELOCKS",
    "-1003745433768": "ZAUR",
}

STATUS_LABELS = {
    "new": "Nieuw",
    "assigned": "Toegewezen",
    "on_the_way": "Onderweg",
    "in_progress": "In uitvoering",
    "needs_quote": "Offerte nodig",
    "for_material": "Materiaal nodig",
    "material_ready": "Materiaal klaar",
    "waiting_dispatcher": "Wacht dispatcher",
    "done": "Werk klaar",
    "completed": "Afgerond",
    "cancelled": "Geannuleerd",
    "reopened": "Heropend",
    "scheduled": "Afspraak gepland",
    "appointment_draft": "Afspraak invullen",
}

PAYMENT_STATUS_LABELS = {
    "unpaid": "Niet betaald",
    "partial": "Deels betaald",
    "paid_full": "Betaald",
    "pay_later": "Betaling later",
    "waiting_confirmation": "Wacht bevestiging",
}

PAYMENT_METHOD_LABELS = {
    "cash": "Cash",
    "bancontact": "Bancontact",
    "overschrijving": "Overschrijving",
    "payconiq": "Payconiq",
    "visa_mastercard": "Visa/Mastercard",
}

AFSPRAAK_TYPE_LABELS = {
    "second_visit": "Nieuwe bezoek",
    "material": "Materiaal",
    "nazorg": "Nazorg",
    "other": "Andere",
}


def format_status(status: str | None) -> str:
    raw = str(status or "").strip()
    return STATUS_LABELS.get(raw, raw or "Onbekend")


def format_payment_status(status: str | None) -> str:
    raw = str(status or "").strip()
    return PAYMENT_STATUS_LABELS.get(raw, raw or "Onbekend")


def format_payment_method(method_code: str | None) -> str:
    raw = str(method_code or "").strip()
    return PAYMENT_METHOD_LABELS.get(raw, raw or "—")


def format_afspraak_type(value: str | None) -> str:
    raw = str(value or "").strip()
    return AFSPRAAK_TYPE_LABELS.get(raw, raw or "Andere")


def classify_group(chat_id) -> tuple[str, str]:
    key = str(chat_id or "")
    if key in PAYMENT_CAPTURE_GROUP_IDS:
        return "regular", PAYMENT_CAPTURE_GROUP_IDS[key]
    if key in CORP_CHATS:
        return "corp", CORP_CHATS[key]
    return "other", key or "—"


def is_internal_receiver(user_id) -> bool:
    try:
        return int(user_id) in INTERNAL_PAYMENT_RECEIVER_IDS
    except Exception:
        return False


def format_dt(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d/%m %H:%M")
    return str(value or "")
