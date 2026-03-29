function parseIntSafe(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const settings = {
  appName: "mini app",
  port: Number(process.env.PORT || 3000),
  dbHost: process.env.MINI_APP_DB_HOST,
  dbUser: process.env.MINI_APP_DB_USER,
  dbPass: process.env.MINI_APP_DB_PASS,
  dbName: process.env.MINI_APP_DB_NAME,
  billitBaseUrl: process.env.BILLIT_BASE_URL || "https://app.billit.eu",
  authCookieName: "mini_app_auth",
  sessionSecret:
    process.env.MINI_APP_SESSION_SECRET ||
    `${process.env.MINI_APP_DB_USER || "mini-app"}:${process.env.MINI_APP_DB_NAME || "dispatcher"}:session`,
  sessionTtlSeconds: parseIntSafe(process.env.MINI_APP_SESSION_TTL_SECONDS, 60 * 60 * 10),
  adminUser: process.env.MINI_APP_ADMIN_USER || "daniel",
  adminPassword: process.env.MINI_APP_ADMIN_PASSWORD || "",
  adminName: process.env.MINI_APP_ADMIN_NAME || "Daniel",
  dispatcherUser: process.env.MINI_APP_DISPATCHER_USER || "ivana",
  dispatcherPassword: process.env.MINI_APP_DISPATCHER_PASSWORD || "",
  dispatcherName: process.env.MINI_APP_DISPATCHER_NAME || "Ivana",
  technicianPassword: process.env.MINI_APP_TECHNICIAN_PASSWORD || "",
  setupCode: process.env.MINI_APP_SETUP_CODE || "",
  resetCode: process.env.MINI_APP_RESET_CODE || process.env.MINI_APP_SETUP_CODE || "",
};

module.exports = { settings };
