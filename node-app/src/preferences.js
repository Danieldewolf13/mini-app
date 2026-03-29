const { query } = require("./db");

const DEFAULT_DASHBOARD_SETTINGS = {
  visible: {
    queue: true,
    jobs: true,
    technicians: true,
    appointments: true,
    detail: true,
    map: true,
  },
  slots: {
    left: "queue",
    center: "jobs",
    sideTop: "technicians",
    sideBottom: "appointments",
  },
};

const DEFAULT_PREFERENCES = {
  language: "nl",
  dashboard: DEFAULT_DASHBOARD_SETTINGS,
};

let schemaReadyPromise = null;

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
}

function sanitizePreferences(raw) {
  const base = cloneDefaults();
  const input = raw && typeof raw === "object" ? raw : {};
  const language = ["nl", "en", "fr", "ru"].includes(String(input.language || "").toLowerCase())
    ? String(input.language).toLowerCase()
    : base.language;

  const dashboard = input.dashboard && typeof input.dashboard === "object" ? input.dashboard : {};
  const visible = dashboard.visible && typeof dashboard.visible === "object" ? dashboard.visible : {};
  const slots = dashboard.slots && typeof dashboard.slots === "object" ? dashboard.slots : {};

  const left = ["queue", "jobs"].includes(slots.left) ? slots.left : base.dashboard.slots.left;
  const center = ["queue", "jobs"].includes(slots.center) && slots.center !== left ? slots.center : left === "queue" ? "jobs" : "queue";
  const sideTop = ["technicians", "appointments"].includes(slots.sideTop) ? slots.sideTop : base.dashboard.slots.sideTop;
  const sideBottom =
    ["technicians", "appointments"].includes(slots.sideBottom) && slots.sideBottom !== sideTop
      ? slots.sideBottom
      : sideTop === "technicians"
        ? "appointments"
        : "technicians";

  return {
    language,
    dashboard: {
      visible: {
        queue: visible.queue !== false,
        jobs: visible.jobs !== false,
        technicians: visible.technicians !== false,
        appointments: visible.appointments !== false,
        detail: visible.detail !== false,
        map: visible.map !== false,
      },
      slots: {
        left,
        center,
        sideTop,
        sideBottom,
      },
    },
  };
}

async function ensurePreferencesSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        username VARCHAR(100) NOT NULL,
        language VARCHAR(10) NOT NULL DEFAULT 'nl',
        dashboard_settings JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  return schemaReadyPromise;
}

async function getUserPreferences(username) {
  await ensurePreferencesSchema();
  if (!username) {
    return cloneDefaults();
  }

  const rows = await query(
    `
      SELECT username, language, dashboard_settings
      FROM user_preferences
      WHERE username = ?
      LIMIT 1
    `,
    [String(username)]
  );

  if (!rows[0]) {
    return cloneDefaults();
  }

  let dashboard = null;
  try {
    dashboard = rows[0].dashboard_settings ? JSON.parse(rows[0].dashboard_settings) : null;
  } catch (error) {
    dashboard = null;
  }

  return sanitizePreferences({
    language: rows[0].language,
    dashboard,
  });
}

async function saveUserPreferences(username, preferences) {
  await ensurePreferencesSchema();
  const safe = sanitizePreferences(preferences);

  await query(
    `
      INSERT INTO user_preferences (username, language, dashboard_settings)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        language = VALUES(language),
        dashboard_settings = VALUES(dashboard_settings),
        updated_at = CURRENT_TIMESTAMP
    `,
    [String(username), safe.language, JSON.stringify(safe.dashboard)]
  );

  return safe;
}

module.exports = {
  DEFAULT_PREFERENCES,
  ensurePreferencesSchema,
  getUserPreferences,
  saveUserPreferences,
  sanitizePreferences,
};
