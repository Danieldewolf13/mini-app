from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ..config import settings


class BillitConfigurationError(RuntimeError):
    pass


class BillitApiError(RuntimeError):
    def __init__(self, status_code: int, message: str, response_body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


@dataclass(frozen=True)
class BillitOrderResult:
    order_id: int
    customer_id: int | None
    raw: dict[str, Any]


def _require_settings() -> None:
    missing = []
    if not settings.billit_api_key:
        missing.append("BILLIT_API_KEY")
    if not settings.billit_party_id:
        missing.append("BILLIT_PARTY_ID")
    if missing:
        raise BillitConfigurationError(
            "Missing Billit configuration: " + ", ".join(missing)
        )

    if "sandbox.billit.be" not in settings.billit_api_url:
        raise BillitConfigurationError(
            "Billit POC is sandbox-only. BILLIT_API_URL must point to api.sandbox.billit.be"
        )


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    _require_settings()
    url = settings.billit_api_url.rstrip("/") + path
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "apiKey": settings.billit_api_key or "",
            "partyID": settings.billit_party_id or "",
        },
    )

    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise BillitApiError(exc.code, f"Billit API returned HTTP {exc.code}", raw) from exc
    except URLError as exc:
        raise BillitApiError(503, f"Billit API unavailable: {exc.reason}") from exc


def find_order_by_external_provider_id(opdracht_id: str) -> dict[str, Any] | None:
    safe_id = opdracht_id.replace("'", "''")
    path = "/v1/orders?$filter=" + quote(
        f"ExternalProviderID eq '{safe_id}'", safe="$()=',"
    )
    result = _request("GET", path)

    if isinstance(result, list):
        return result[0] if result else None
    if isinstance(result, dict):
        rows = result.get("Items") or result.get("items") or result.get("value") or []
        if isinstance(rows, list) and rows:
            return rows[0]
    return None


def create_invoice_order(data: dict[str, Any]) -> BillitOrderResult:
    existing = find_order_by_external_provider_id(data["opdracht_id"])
    if existing:
        order_id = existing.get("OrderID") or existing.get("orderID") or existing.get("id")
        if order_id is None:
            raise BillitApiError(502, "Existing Billit order has no OrderID")
        customer_id = existing.get("CustomerID") or existing.get("customerID")
        return BillitOrderResult(int(order_id), int(customer_id) if customer_id else None, existing)

    order_date = date.today()
    expiry_date = order_date + timedelta(days=data.get("payment_term_days", 14))

    customer: dict[str, Any] = {
        "Name": data["customer_name"],
        "ExternalProviderID": data.get("customer_external_id") or data["opdracht_id"],
    }
    if data.get("vat_number"):
        customer["VATNumber"] = data["vat_number"]
    if data.get("email"):
        customer["Email"] = data["email"]
    if data.get("phone"):
        customer["Phone"] = data["phone"]

    address = {
        "AddressType": "InvoiceAddress",
        "Street": data.get("street") or "",
        "Zipcode": data.get("postal_code") or "",
        "City": data.get("city") or "",
        "CountryCode": data.get("country_code") or "BE",
    }
    if any(address[k] for k in ("Street", "Zipcode", "City")):
        customer["Addresses"] = [address]

    payload = {
        "OrderType": "Invoice",
        "OrderDirection": "Income",
        "OrderDate": order_date.isoformat(),
        "ExpiryDate": expiry_date.isoformat(),
        "ExternalProviderID": data["opdracht_id"],
        "Customer": customer,
        "OrderLines": [
            {
                "Description": data.get("description") or f"Interventie {data['opdracht_id']}",
                "Quantity": 1,
                "UnitPriceExcl": data["amount_excl_vat"],
                "VATPercentage": data["vat_percentage"],
            }
        ],
    }

    result = _request("POST", "/v1/orders", payload)
    if not isinstance(result, dict):
        raise BillitApiError(502, "Unexpected Billit response while creating order")

    order_id = result.get("OrderID") or result.get("orderID") or result.get("id")
    if order_id is None:
        raise BillitApiError(502, "Billit response did not contain OrderID", json.dumps(result))

    customer_id = result.get("CustomerID") or result.get("customerID")
    return BillitOrderResult(int(order_id), int(customer_id) if customer_id else None, result)
