const crypto = require("crypto");
const { settings } = require("./config");
const { fetchUserByTechKey } = require("./repository");

const COOKIE_NAME = settings.authCookieName;

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

function serializeUser(user) {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    tg_id: user.tg_id || null,
    tech_key: user.tech_key || null,
  };
}

function buildCookieValue(user) {
  const payload = {
    ...serializeUser(user),
    exp: Date.now() + settings.sessionTtlSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function buildSetCookieHeader(user) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${buildCookieValue(user)}; Max-Age=${settings.sessionTtlSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`;
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

async function authenticateCredentials(usernameInput, passwordInput) {
  const username = String(usernameInput || "").trim().toLowerCase();
  const password = String(passwordInput || "");

  if (!username || !password) {
    return null;
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

module.exports = {
  authenticateCredentials,
  buildClearCookieHeader,
  buildSetCookieHeader,
  canAccessNav,
  canAssign,
  canViewFinance,
  filterNavigationForUser,
  requireAuthApi,
  requireAuthPage,
  serializeUser,
  withAuth,
};
