/**
 * Google Calendar integration for the mini-app dispatcher.
 * Uses the same service account as the Telegram bot (GOOGLE_CREDENTIALS env var).
 */

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
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Get calendar ID for a tech_key (case-insensitive).
 */
function getCalendarId(techKey) {
  if (!techKey) return null;
  return CALENDAR_MAP[String(techKey).toUpperCase()] || null;
}

/**
 * Create or update a calendar event for a job appointment.
 * Returns the event ID if successful, null otherwise.
 */
async function upsertCalendarEvent({ techKey, eventId, title, description, address, scheduledAt, durationMinutes = 60 }) {
  const credentials = getCredentials();
  const calendarId = getCalendarId(techKey);
  if (!credentials || !calendarId) return null;

  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = google.calendar({ version: "v3", auth });

    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const event = {
      summary: title,
      description: description || "",
      location: address || "",
      start: { dateTime: start.toISOString(), timeZone: "Europe/Brussels" },
      end:   { dateTime: end.toISOString(),   timeZone: "Europe/Brussels" },
    };

    if (eventId) {
      // Update existing event
      const res = await calendar.events.update({ calendarId, eventId, requestBody: event });
      return res.data.id;
    } else {
      // Create new event
      const res = await calendar.events.insert({ calendarId, requestBody: event });
      return res.data.id;
    }
  } catch (err) {
    console.error("Google Calendar error:", err.message || err);
    return null;
  }
}

async function deleteCalendarEvent({ techKey, eventId }) {
  if (!techKey || !eventId) return false;
  const credentials = getCredentials();
  const calendarId = getCalendarId(techKey);
  if (!credentials || !calendarId) return false;

  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = google.calendar({ version: "v3", auth });
    await calendar.events.delete({ calendarId, eventId });
    return true;
  } catch (err) {
    console.error("Google Calendar delete error:", err.message || err);
    return false;
  }
}

/**
 * Fetch upcoming events for one or all technicians (next N days).
 * Returns array of { techKey, calendarId, events[] }
 */
async function fetchUpcomingCalendarEvents(techKeys, daysAhead = 7) {
  const credentials = getCredentials();
  if (!credentials) return [];

  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const until = new Date(now.getTime() + daysAhead * 86400000);

    const keys = Array.isArray(techKeys) ? techKeys : Object.keys(CALENDAR_MAP);
    const results = [];

    for (const key of keys) {
      const calendarId = getCalendarId(key);
      if (!calendarId) continue;
      try {
        const res = await calendar.events.list({
          calendarId,
          timeMin: now.toISOString(),
          timeMax: until.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 50,
        });
        results.push({
          techKey: key,
          calendarId,
          events: (res.data.items || []).map((e) => ({
            id: e.id,
            title: e.summary || "",
            description: e.description || "",
            location: e.location || "",
            start: e.start?.dateTime || e.start?.date,
            end:   e.end?.dateTime   || e.end?.date,
          })),
        });
      } catch (_) {
        // skip calendars that fail individually
      }
    }
    return results;
  } catch (err) {
    console.error("Google Calendar fetch error:", err.message || err);
    return [];
  }
}

module.exports = { upsertCalendarEvent, deleteCalendarEvent, fetchUpcomingCalendarEvents, getCalendarId, CALENDAR_MAP };
