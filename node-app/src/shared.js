const INTERNAL_PAYMENT_RECEIVER_IDS = new Set([457141175, 7909226479]);

const PAYMENT_CAPTURE_GROUP_IDS = {
  "-1002299448091": "APTI",
  "-1002276060500": "ARBI",
  "-1001562342633": "DAN",
  "-1002455598483": "ISA",
  "-1002340152626": "MANS",
  "-1002397008426": "RAS",
};

const CORP_CHATS = {
  "-1002649403969": "RALOCKS",
  "-1003251768093": "SECURELOCKS",
  "-1003745433768": "ZAUR",
};

const STATUS_LABELS = {
  new: "Nieuw",
  assigned: "Toegewezen",
  on_the_way: "Onderweg",
  in_progress: "In uitvoering",
  needs_quote: "Offerte nodig",
  for_material: "Materiaal nodig",
  material_ready: "Materiaal klaar",
  waiting_dispatcher: "Wacht dispatcher",
  done: "Werk klaar",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  reopened: "Heropend",
  scheduled: "Afspraak gepland",
  appointment_draft: "Afspraak invullen",
};

const PAYMENT_STATUS_LABELS = {
  unpaid: "Niet betaald",
  partial: "Deels betaald",
  paid_full: "Betaald",
  pay_later: "Betaling later",
  waiting_confirmation: "Wacht bevestiging",
};

const PAYMENT_METHOD_LABELS = {
  cash: "Cash",
  bancontact: "Bancontact",
  overschrijving: "Overschrijving",
  payconiq: "Payconiq",
  visa_mastercard: "Visa/Mastercard",
};

const AFSPRAAK_TYPE_LABELS = {
  second_visit: "Nieuwe bezoek",
  material: "Materiaal",
  nazorg: "Nazorg",
  other: "Andere",
};

function normalizeString(value) {
  return String(value || "").trim();
}

function formatStatus(status) {
  const raw = normalizeString(status);
  return STATUS_LABELS[raw] || raw || "Onbekend";
}

function formatPaymentStatus(status) {
  const raw = normalizeString(status);
  return PAYMENT_STATUS_LABELS[raw] || raw || "Onbekend";
}

function formatPaymentMethod(methodCode) {
  const raw = normalizeString(methodCode);
  return PAYMENT_METHOD_LABELS[raw] || raw || "-";
}

function formatAfspraakType(value) {
  const raw = normalizeString(value);
  return AFSPRAAK_TYPE_LABELS[raw] || raw || "Andere";
}

function classifyGroup(chatId) {
  const key = String(chatId || "");
  if (PAYMENT_CAPTURE_GROUP_IDS[key]) {
    return ["regular", PAYMENT_CAPTURE_GROUP_IDS[key]];
  }
  if (CORP_CHATS[key]) {
    return ["corp", CORP_CHATS[key]];
  }
  return ["other", key || "-"];
}

function isInternalReceiver(userId) {
  const parsed = Number(userId);
  return Number.isFinite(parsed) && INTERNAL_PAYMENT_RECEIVER_IDS.has(parsed);
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt).replace(",", "");
}

function formatGeneratedAt(date = new Date()) {
  return new Intl.DateTimeFormat("nl-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

module.exports = {
  classifyGroup,
  formatAfspraakType,
  formatDateTime,
  formatGeneratedAt,
  formatPaymentMethod,
  formatPaymentStatus,
  formatStatus,
  isInternalReceiver,
};
