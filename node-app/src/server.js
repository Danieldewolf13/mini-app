const express = require("express");
const path = require("path");
const { settings } = require("./config");
const { buildDashboardPayload, buildJobsPayload, buildJobDetailPayload } = require("./repository");
const { getPlanningData } = require("./services/planningService");

const app = express();
const staticDir = path.resolve(__dirname, "../public");
const viewsDir = path.resolve(__dirname, "../views");

const navigation = [
  { href: "/dispatcher/dashboard", label: "Dashboard", key: "dashboard" },
  { href: "/dispatcher/jobs", label: "Jobs", key: "jobs" },
  { href: "/dispatcher/planning", label: "Planning", key: "planning" },
  { href: "/dispatcher/calendar", label: "Calendar", key: "calendar" },
  { href: "/dispatcher/technicians", label: "Technicians", key: "technicians" },
  { href: "/dispatcher/documents", label: "Documents", key: "documents" },
  { href: "/dispatcher/finance", label: "Finance", key: "finance" },
];

app.set("view engine", "ejs");
app.set("views", viewsDir);
app.use("/static", express.static(staticDir));

function emptyDashboardPayload(errorMessage = null) {
  return {
    kpis: {
      requires_action: 0,
      urgent: 0,
      free_tech: 0,
      upcoming: 0,
    },
    queue: {
      unassigned: [],
      overdue: [],
    },
    jobs: [],
    appointments: [],
    technicians: [],
    map: {},
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

async function loadJobsPayload() {
  try {
    const payload = await buildJobsPayload();
    return {
      ...payload,
      db_error: null,
    };
  } catch (error) {
    return {
      jobs: [],
      technicians: [],
      filters: { statuses: [], technicians: [] },
      db_error: error.message || String(error),
    };
  }
}

function baseViewModel({
  pageTitle,
  activeNav,
  dbError = null,
  actions = [],
  contentClass = "",
  rightPanel = null,
  extraStyles = [],
  extraScripts = [],
  ...payload
}) {
  return {
    pageTitle,
    activeNav,
    billitBaseUrl: settings.billitBaseUrl,
    currentPath: activeNav,
    navigation,
    dbError,
    contentClass,
    rightPanel,
    actions,
    extraStyles,
    extraScripts,
    serialize: (value) => JSON.stringify(value ?? []),
    ...payload,
  };
}

function renderPlaceholder(res, key, title, description) {
  res.render(
    "dispatcher/placeholder",
    baseViewModel({
      pageTitle: title,
      activeNav: key,
      title,
      description,
      actions: [],
    })
  );
}

app.get("/", (req, res) => {
  res.redirect("/dispatcher/dashboard");
});

app.get("/dispatcher", (req, res) => {
  res.redirect("/dispatcher/dashboard");
});

app.get("/dispatcher/dashboard", async (req, res) => {
  const payload = await loadDashboardPayload();
  res.render(
    "dispatcher/dashboard",
    baseViewModel({
      pageTitle: "Dispatcher dashboard",
      activeNav: "dashboard",
      actions: [
        { href: settings.billitBaseUrl, label: "Open Billit", variant: "ghost", external: true },
        { href: "/api/dashboard", label: "Live JSON", variant: "ghost", external: true },
      ],
      rightPanel: "dispatcher/partials/job_detail_panel",
      ...payload,
    })
  );
});

app.get("/dispatcher/jobs", async (req, res) => {
  const payload = await loadJobsPayload();
  res.render(
    "dispatcher/jobs",
    baseViewModel({
      pageTitle: "Jobs",
      activeNav: "jobs",
      actions: [{ href: "#", label: "+ Job", variant: "primary" }],
      jobs: payload.jobs,
      technicians: payload.technicians,
      filters: payload.filters,
      dbError: payload.db_error,
    })
  );
});

app.get("/dispatcher/planning", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.render(
    "dispatcher/planning",
    baseViewModel({
      pageTitle: "Planning",
      activeNav: "planning",
      rightPanel: "dispatcher/partials/job_detail_panel",
      extraStyles: ["/static/css/planning.css?v=planning-1"],
      extraScripts: ["/static/js/planning.js?v=planning-1"],
      planning_date: today,
      planning_view: "day",
      actions: [],
    })
  );
});

app.get("/dispatcher/calendar", (req, res) => {
  renderPlaceholder(res, "calendar", "Calendar", "Calendar wordt in de volgende stap aangesloten op de dispatcherstructuur.");
});

app.get("/dispatcher/technicians", (req, res) => {
  renderPlaceholder(res, "technicians", "Technicians", "Techniekerbeheer komt op deze pagina zodra de basisstructuur vastligt.");
});

app.get("/dispatcher/documents", (req, res) => {
  renderPlaceholder(res, "documents", "Documents", "Documentcontrole komt hier in een volgende fase.");
});

app.get("/dispatcher/finance", (req, res) => {
  renderPlaceholder(res, "finance", "Finance", "Finance krijgt hier later zijn eigen werkoverzicht.");
});

app.get("/api/dashboard", async (req, res) => {
  const payload = await loadDashboardPayload();
  res.status(payload.db_error ? 503 : 200).json(payload);
});

app.get("/api/planning", async (req, res) => {
  try {
    const payload = await getPlanningData(req.query.date, req.query.view);
    res.json(payload);
  } catch (error) {
    res.status(503).json({
      date: req.query.date || "",
      view: req.query.view || "day",
      technicians: [],
      jobs: [],
      error: error.message || String(error),
    });
  }
});

app.get("/api/jobs", async (req, res) => {
  const payload = await loadJobsPayload();
  const jobs = payload.jobs.map((job) => ({
    id: job.id,
    client: job.client,
    city: job.city,
    status: job.status,
    technician: job.technician,
  }));
  res.status(payload.db_error ? 503 : 200).json(jobs);
});

app.get("/api/jobs/:id", async (req, res) => {
  const payload = await buildJobDetailPayload(req.params.id);
  if (!payload) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(payload);
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
