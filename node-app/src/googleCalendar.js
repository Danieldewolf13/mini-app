/**
 * Google Calendar integration — geen externe packages nodig.
 * Gebruikt Node.js ingebouwde crypto + https modules met service account JWT.
 */

const crypto = require("crypto");
const https  = require("https");

const CALENDAR_MAP = {
  APTI:        "c_103790318ae882bd0068f7229227c1212484c6f25eac55262b990b02b11ed274@group.calendar.google.com",
  ARBI:        "c_2871592f4fcbf6692f7143428d355f9cb85d116177c5301a07db6a2d3ed32ba8@group.calendar.google.com",
  DAN:         "c_c4e37c761d790c853d5820c6bed87e42a6c33d37e516716b71106aa7d028ade0@group.calendar.google.com",
  ISA:         "c_3b466a50a9bab6ba5c90e22c3555fa1af951d06a070a0d53187b5e001695c54f@group.calendar.google.com",
  MANS:        "c_e2edfd70322f9fe846e9e21f851ba80c0db7fbe6517008cf960a02f73ff2f1b9@group.calendar.google.com",
  RAS:         "c_5c19c5af22090250a499212495848982de6f713664f86bfaa04d358cfa9c3203@group.calendar.google.com",
  RALOCKS:     "c_0389a853493579805ffe975723109ea15e366cba0ca7ba5f5026238ccac00882@group.calendar.google.com",
  SECURELOCKS: "c_bf981a625851751c393731f8471a0c40d4a6af5695971c37037242072dfca841@group.calendar.google.com",
};

function getCredentials() {
  const raw = process.env.GOOGLE_CREDENTIALS || "";
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function getCalendarId(techKey) {
  if (!techKey) return null;
  return CALENDAR_MAP[String(techKey).toUpperCase()] || null;
}

// ── JWT helpers ────────────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str).toString("base64url");
}

function makeJwt(credentials, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const sig = sign.sign(credentials.private_key, "base64url");
  return `${unsigned}.${sig}`;
}

async function getAccessToken(credentials, scope) {
  const jwt = makeJwt(credentials, scope);
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const data = await httpPost("https://oauth2.googleapis.com/token", body, {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  return data.access_token || null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Length": buf.length, ...headers },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
      });
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
      });
    }).on("error", reject);
  });
}

function httpRequest(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(buf ? { "Content-Type": "application/json", "Content-Length": buf.length } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch (_) { resolve({}); }
      });
    });
    req.on("error", reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────

async function upsertCalendarEvent({ techKey, eventId, title, description, address, scheduledAt, durationMinutes = 60 }) {
  const creds = getCredentials();
  const calendarId = getCalendarId(techKey);
  if (!creds || !calendarId) return null;

  try {
    const token = await getAccessToken(creds, "https://www.googleapis.com/auth/calendar");
    if (!token) return null;

    const start = new Date(scheduledAt);
    const end   = new Date(start.getTime() + durationMinutes * 60000);
    const event = {
      summary:     title,
      description: description || "",
      location:    address || "",
      start: { dateTime: start.toISOString(), timeZone: "Europe/Brussels" },
      end:   { dateTime: end.toISOString(),   timeZone: "Europe/Brussels" },
    };

    const calEncoded = encodeURIComponent(calendarId);
    if (eventId) {
      const res = await httpRequest("PUT",
        `https://www.googleapis.com/calendar/v3/calendars/${calEncoded}/events/${eventId}`,
        token, event);
      return res.id || null;
    } else {
      const res = await httpRequest("POST",
        `https://www.googleapis.com/calendar/v3/calendars/${calEncoded}/events`,
        token, event);
      return res.id || null;
    }
  } catch (err) {
    console.error("Google Calendar upsert error:", err.message);
    return null;
  }
}

async function deleteCalendarEvent({ techKey, eventId }) {
  if (!techKey || !eventId) return false;
  const creds = getCredentials();
  const calendarId = getCalendarId(techKey);
  if (!creds || !calendarId) return false;

  try {
    const token = await getAccessToken(creds, "https://www.googleapis.com/auth/calendar");
    if (!token) return false;
    const calEncoded = encodeURIComponent(calendarId);
    await httpRequest("DELETE",
      `https://www.googleapis.com/calendar/v3/calendars/${calEncoded}/events/${eventId}`,
      token, null);
    return true;
  } catch (err) {
    console.error("Google Calendar delete error:", err.message);
    return false;
  }
}

async function fetchUpcomingCalendarEvents(techKeys, daysAhead = 14) {
  const creds = getCredentials();
  if (!creds) return [];

  try {
    const token = await getAccessToken(creds, "https://www.googleapis.com/auth/calendar.readonly");
    if (!token) return [];

    const now   = new Date();
    const until = new Date(now.getTime() + daysAhead * 86400000);
    const keys  = Array.isArray(techKeys) ? techKeys : Object.keys(CALENDAR_MAP);
    const results = [];

    for (const key of keys) {
      const calendarId = getCalendarId(key);
      if (!calendarId) continue;
      try {
        const calEncoded = encodeURIComponent(calendarId);
        const url = `https://www.googleapis.com/calendar/v3/calendars/${calEncoded}/events`
          + `?timeMin=${encodeURIComponent(now.toISOString())}`
          + `&timeMax=${encodeURIComponent(until.toISOString())}`
          + `&singleEvents=true&orderBy=startTime&maxResults=50`;
        const data = await httpGet(url, token);
        results.push({
          techKey: key,
          calendarId,
          events: (data.items || []).map((e) => ({
            id:          e.id,
            title:       e.summary || "",
            description: e.description || "",
            location:    e.location || "",
            start:       e.start?.dateTime || e.start?.date,
            end:         e.end?.dateTime   || e.end?.date,
          })),
        });
      } catch (_) { /* skip individual failures */ }
    }
    return results;
  } catch (err) {
    console.error("Google Calendar fetch error:", err.message);
    return [];
  }
}

module.exports = { upsertCalendarEvent, deleteCalendarEvent, fetchUpcomingCalendarEvents, getCalendarId, CALENDAR_MAP };
