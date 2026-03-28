const express = require("express");
const path = require("path");
const { settings } = require("./config");
const { buildDashboardPayload } = require("./repository");

const app = express();
const staticDir = path.resolve(__dirname, "../../app/static");
const viewsDir = path.resolve(__dirname, "../views");

app.set("view engine", "ejs");
app.set("views", viewsDir);
app.use("/static", express.static(staticDir));

function emptyDashboardPayload(errorMessage = null) {
  return {
    jobs: [],
    appointments: [],
    technicians: [],
    status_counts: {},
    category_counts: {},
    regular_jobs: 0,
    corp_jobs: 0,
    generated_at: "nog niet beschikbaar",
    db_error: errorMessage,
  };
}

async function loadDashboardPayload() {
  try {
    const payload = await buildDashboardPayload();
    payload.db_error = null;
    return payload;
  } catch (error) {
    return emptyDashboardPayload(error.message || String(error));
  }
}

function baseViewModel(payload) {
  return {
    pageTitle: "Dispatcher dashboard",
    billitBaseUrl: settings.billitBaseUrl,
    serialize: (value) => JSON.stringify(value ?? []),
    ...payload,
  };
}

app.get(["/", "/dispatcher"], async (req, res) => {
  const payload = await loadDashboardPayload();
  res.render("dispatcher-dashboard", baseViewModel(payload));
});

app.get("/api/dashboard", async (req, res) => {
  const payload = await loadDashboardPayload();
  res.status(payload.db_error ? 503 : 200).json(payload);
});

app.get("/health", (req, res) => {
  res.json({ ok: true, app: settings.appName });
});

if (require.main === module) {
  app.listen(settings.port, () => {
    console.log(`Node mini app draait op http://127.0.0.1:${settings.port}`);
  });
}

module.exports = { app };
