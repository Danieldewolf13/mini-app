const crypto = require("crypto");
const { settings } = require("./config");
const { query } = require("./db");
const { fetchUserByTechKey } = require("./repository");

const COOKIE_NAME = settings.authCookieName;
const DEFAULT_REMEMBER_SECONDS = 30 * 24 * 60 * 60;

let schemaReadyPromise = null;

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return acc;
      }

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function sign(value) {
  return crypto.createHmac("sha256", settings.sessionSecret).update(value).digest("base64url");
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password) {
  const iterations = 120000;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, iterationRaw, salt, expectedHash] = String(storedHash || "").split("$");
  if (algorithm !== "pbkdf2" || !iterationRaw || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationRaw);
  if (!Number.isFinite(iterations)) {
    return false;
  }

  const computed = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(expectedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function ensureAuthSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'technician',
        tg_id BIGINT NULL,
        tech_key VARCHAR(50) NULL,
        full_name VARCHAR(191) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_auth_username (username),
        KEY idx_auth_role_active (role, is_active),
        KEY idx_auth_tg (tg_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  return schemaReadyPromise;
}

async function findAuthUserByUsername(username) {
  await ensureAuthSchema();
  const rows = await query(
    `
      SELECT id, username, password_hash, role, tg_id, tech_key, full_name, is_active
      FROM auth_users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
    `,
    [normalizeUsername(username)]
  );
  return rows[0] || null;
}

async function createAuthUser({ username, password, role, fullName, tgId = null, techKey = null }) {
  await ensureAuthSchema();
  const normalizedUsername = normalizeUsername(username);

  await query(
    `
      INSERT INTO auth_users (username, password_hash, role, tg_id, tech_key, full_name, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `,
    [normalizedUsername, hashPassword(password), role, tgId, techKey, fullName]
  );

  return findAuthUserByUsername(normalizedUsername);
}

async function updateAuthUserPassword(username, password) {
  await ensureAuthSchema();
  await query(
    `
      UPDATE auth_users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(username) = LOWER(?)
    `,
    [hashPassword(password), normalizeUsername(username)]
  );
}

function serializeUser(user) {
  return {
    username: user.username,
    name: user.name || user.full_name,
    role: user.role,
    tg_id: user.tg_id || null,
    tech_key: user.tech_key || null,
  };
}

function buildCookieValue(user, options = {}) {
  const maxAge = options.remember ? DEFAULT_REMEMBER_SECONDS : settings.sessionTtlSeconds;
  const payload = {
    ...serializeUser(user),
    remember: Boolean(options.remember),
    exp: Date.now() + maxAge * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function buildSetCookieHeader(user, options = {}) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = options.remember ? DEFAULT_REMEMBER_SECONDS : settings.sessionTtlSeconds;
  return `${COOKIE_NAME}=${buildCookieValue(user, options)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function buildClearCookieHeader() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

function readAuthUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) {
    return null;
  }

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = sign(encoded);
  const safeExpected = Buffer.from(expected);
  const safeSignature = Buffer.from(signature);

  if (safeExpected.length !== safeSignature.length || !crypto.timingSafeEqual(safeExpected, safeSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload?.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function withAuth(req, _res, next) {
  req.authUser = readAuthUser(req);
  next();
}

function requireAuthPage(req, res, next) {
  if (req.authUser) {
    next();
    return;
  }

  const nextPath = encodeURIComponent(req.originalUrl || "/dispatcher/dashboard");
  res.redirect(`/login?next=${nextPath}`);
}

function requireAuthApi(req, res, next) {
  if (req.authUser) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}

function canAccessNav(user, key) {
  if (!user) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  if (user.role === "dispatcher") {
    return key !== "finance";
  }

  if (user.role === "technician") {
    return ["dashboard", "jobs", "planning", "calendar", "documents"].includes(key);
  }

  return false;
}

function canViewFinance(user) {
  return Boolean(user && user.role === "admin");
}

function canAssign(user) {
  return Boolean(user && (user.role === "admin" || user.role === "dispatcher"));
}

function filterNavigationForUser(navigation, user) {
  return navigation.filter((item) => canAccessNav(user, item.key));
}

function isRememberRequested(value) {
  return value === "1" || value === "true" || value === "on";
}

async function authenticateCredentials(usernameInput, passwordInput) {
  const username = normalizeUsername(usernameInput);
  const password = String(passwordInput || "");

  if (!username || !password) {
    return null;
  }

  const dbUser = await findAuthUserByUsername(username);
  if (dbUser && dbUser.is_active && verifyPassword(password, dbUser.password_hash)) {
    return {
      username: dbUser.username,
      name: dbUser.full_name,
      role: dbUser.role,
      tg_id: dbUser.tg_id,
      tech_key: dbUser.tech_key,
    };
  }

  if (settings.adminPassword && username === settings.adminUser.toLowerCase() && password === settings.adminPassword) {
    return {
      username: settings.adminUser,
      name: settings.adminName,
      role: "admin",
    };
  }

  if (
    settings.dispatcherPassword &&
    username === settings.dispatcherUser.toLowerCase() &&
    password === settings.dispatcherPassword
  ) {
    return {
      username: settings.dispatcherUser,
      name: settings.dispatcherName,
      role: "dispatcher",
    };
  }

  if (!settings.technicianPassword || password !== settings.technicianPassword) {
    return null;
  }

  const technician = await fetchUserByTechKey(username);
  if (!technician) {
    return null;
  }

  return {
    username,
    name: technician.full_name,
    role: "technician",
    tg_id: technician.tg_id,
    tech_key: technician.tech_key,
  };
}

async function registerAccount({ username, password, fullName, role, techKey, setupCode }) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedUsername = normalizeUsername(username);
  const safePassword = String(password || "");
  const safeName = String(fullName || "").trim();

  if (!normalizedUsername || safePassword.length < 8) {
    throw new Error("Gebruik een geldige gebruikersnaam en een wachtwoord van minstens 8 tekens.");
  }

  if (!["admin", "dispatcher", "technician"].includes(normalizedRole)) {
    throw new Error("Ongeldige rol voor registratie.");
  }

  const existing = await findAuthUserByUsername(normalizedUsername);
  if (existing) {
    throw new Error("Deze gebruikersnaam bestaat al.");
  }

  if (normalizedRole === "technician") {
    const technician = await fetchUserByTechKey(techKey);
    if (!technician) {
      throw new Error("Onbekende techniekercode.");
    }

    return createAuthUser({
      username: normalizedUsername,
      password: safePassword,
      role: "technician",
      fullName: technician.full_name,
      tgId: technician.tg_id,
      techKey: technician.tech_key,
    });
  }

  if (!settings.setupCode || String(setupCode || "") !== settings.setupCode) {
    throw new Error("Ongeldige registratiecode.");
  }

  return createAuthUser({
    username: normalizedUsername,
    password: safePassword,
    role: normalizedRole,
    fullName: safeName || normalizedUsername,
  });
}

async function resetPassword({ username, password, resetCode, actor }) {
  const normalizedUsername = normalizeUsername(username);
  const safePassword = String(password || "");

  if (!normalizedUsername || safePassword.length < 8) {
    throw new Error("Gebruik een geldige gebruikersnaam en een wachtwoord van minstens 8 tekens.");
  }

  const existing = await findAuthUserByUsername(normalizedUsername);
  if (!existing) {
    throw new Error("Gebruiker niet gevonden.");
  }

  if (!actor || actor.role !== "admin") {
    if (!settings.resetCode || String(resetCode || "") !== settings.resetCode) {
      throw new Error("Ongeldige resetcode.");
    }
  }

  await updateAuthUserPassword(normalizedUsername, safePassword);
}

module.exports = {
  authenticateCredentials,
  buildClearCookieHeader,
  buildSetCookieHeader,
  canAccessNav,
  canAssign,
  canViewFinance,
  ensureAuthSchema,
  filterNavigationForUser,
  isRememberRequested,
  registerAccount,
  requireAuthApi,
  requireAuthPage,
  resetPassword,
  serializeUser,
  withAuth,
};
