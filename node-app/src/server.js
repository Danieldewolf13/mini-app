const express = require("express");
const path = require("path");
const { settings } = require("./config");
const {
  assignJobTechnician,
  buildDashboardPayload,
  buildJobsPayload,
  buildJobDetailPayload,
  fetchPlanningTechnicians,
  updateJobStatus,
} = require("./repository");
const { getPlanningData } = require("./services/planningService");
const { createTranslator } = require("./i18n");
const { ensurePreferencesSchema, getUserPreferences, saveUserPreferences, sanitizePreferences } = require("./preferences");
const {
  adminCreateUser,
  adminToggleUserActive,
  authenticateCredentials,
  buildClearCookieHeader,
  buildSetCookieHeader,
  canAccessNav,
  canAssign,
  canViewFinance,
  ensureAuthSchema,
  filterNavigationForUser,
  isRememberRequested,
  listAuthUsers,
  registerAccount,
  requireAuthApi,
  requireAuthPage,
  resetPassword,
  serializeUser,
  withAuth,
} = require("./auth");

const app = express();
const staticDir = path.resolve(__dirname, "../public");
const viewsDir = path.resolve(__dirname, "../views");

const navigation = [
  { href: "/dispatcher/dashboard", labelKey: "nav.dashboard", fallbackLabel: "Dashboard", key: "dashboard" },
  { href: "/dispatcher/jobs", labelKey: "nav.jobs", fallbackLabel: "Jobs", key: "jobs" },
  { href: "/dispatcher/planning", labelKey: "nav.planning", fallbackLabel: "Planning", key: "planning" },
  { href: "/dispatcher/calendar", labelKey: "nav.calendar", fallbackLabel: "Calendar", key: "calendar" },
  { href: "/dispatcher/technicians", labelKey: "nav.technicians", fallbackLabel: "Technicians", key: "technicians" },
  { href: "/dispatcher/documents", labelKey: "nav.documents", fallbackLabel: "Documents", key: "documents" },
  { href: "/dispatcher/finance", labelKey: "nav.finance", fallbackLabel: "Finance", key: "finance" },
  { href: "/dispatcher/users", labelKey: "nav.users", fallbackLabel: "Users", key: "users" },
  { href: "/dispatcher/settings", labelKey: "nav.settings", fallbackLabel: "Settings", key: "settings" },
];

app.set("view engine", "ejs");
app.set("views", viewsDir);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/static", express.static(staticDir));
app.use(withAuth);
app.use(async (_req, _res, next) => {
  try {
    await ensureAuthSchema();
    await ensurePreferencesSchema();
    next();
  } catch (error) {
    next(error);
  }
});

app.use(async (req, _res, next) => {
  try {
    req.userPreferences = req.authUser ? await getUserPreferences(req.authUser.username) : sanitizePreferences();
    next();
  } catch (error) {
    next(error);
  }
});

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

function buildQueue(jobs) {
  const now = Date.now();
  const buckets = {
    unassigned: [],
    overdue: [],
    waiting_confirmation: [],
    missing_documents: [],
  };

  for (const job of jobs) {
    const createdAt = new Date(job.created_at).getTime();
    const isOverdue =
      !Number.isNaN(createdAt) &&
      ["new", "waiting_dispatcher", "assigned"].includes(job.status) &&
      now - createdAt > 4 * 60 * 60 * 1000;
    const isWaitingConfirmation = job.payment_status === "waiting_confirmation";
    const isMissingDocuments =
      !job.invoice_number && ["partial", "paid_full", "waiting_confirmation"].includes(job.payment_status);

    const item = {
      id: job.id,
      client: job.client,
      city: job.city || "-",
      status: job.status_label,
      technician: job.technician || "Unassigned",
      created_at: job.created_at_label,
    };

    if (!job.technician_id) {
      buckets.unassigned.push(item);
    } else if (isOverdue) {
      buckets.overdue.push(item);
    } else if (isWaitingConfirmation) {
      buckets.waiting_confirmation.push(item);
    } else if (isMissingDocuments) {
      buckets.missing_documents.push(item);
    }
  }

  return {
    unassigned: buckets.unassigned.slice(0, 6),
    overdue: buckets.overdue.slice(0, 6),
    waiting_confirmation: buckets.waiting_confirmation.slice(0, 6),
    missing_documents: buckets.missing_documents.slice(0, 6),
  };
}

function buildKpis({ jobs, technicians, appointments, queue }) {
  const urgent = jobs.filter((job) => {
    const status = String(job.status || "").toLowerCase();
    const category = String(job.category || "").toLowerCase();
    return category.includes("dring") || status === "on_the_way";
  }).length;

  const freeTech = technicians.filter((tech) => Number(tech.active_jobs || 0) === 0).length;

  return {
    requires_action:
      queue.unassigned.length +
      queue.overdue.length +
      queue.waiting_confirmation.length +
      queue.missing_documents.length,
    urgent,
    free_tech: freeTech,
    upcoming: appointments.length,
  };
}

function filterJobsForUser(jobs, user) {
  if (!user || user.role !== "technician") {
    return jobs;
  }

  return jobs.filter((job) => Number(job.technician_id) === Number(user.tg_id));
}

function filterAppointmentsForUser(appointments, user) {
  if (!user || user.role !== "technician") {
    return appointments;
  }

  return appointments.filter((appointment) => Number(appointment.technician_id) === Number(user.tg_id));
}

function filterTechniciansForUser(technicians, user) {
  if (!user || user.role !== "technician") {
    return technicians;
  }

  return technicians.filter((tech) => Number(tech.tg_id) === Number(user.tg_id));
}

function scopeDashboardPayload(payload, user) {
  if (!user || user.role !== "technician") {
    return payload;
  }

  const jobs = filterJobsForUser(payload.jobs, user);
  const appointments = filterAppointmentsForUser(payload.appointments, user);
  const technicians = filterTechniciansForUser(payload.technicians, user);
  const queue = buildQueue(jobs);
  const kpis = buildKpis({ jobs, technicians, appointments, queue });

  const statusCounts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  const categoryCounts = jobs.reduce((acc, job) => {
    acc[job.category] = (acc[job.category] || 0) + 1;
    return acc;
  }, {});

  return {
    ...payload,
    jobs,
    appointments,
    technicians,
    queue,
    kpis,
    status_counts: statusCounts,
    category_counts: categoryCounts,
    regular_jobs: jobs.filter((job) => job.group_type === "regular").length,
    corp_jobs: jobs.filter((job) => job.group_type === "corp").length,
  };
}

function scopeJobsPayload(payload, user) {
  if (!user || user.role !== "technician") {
    return payload;
  }

  const jobs = filterJobsForUser(payload.jobs, user);
  const technicians = filterTechniciansForUser(payload.technicians, user);

  return {
    ...payload,
    jobs,
    technicians,
    filters: {
      statuses: [...new Set(jobs.map((job) => job.status).filter(Boolean))],
      technicians: technicians.map((tech) => ({ id: tech.tg_id, name: tech.full_name })),
    },
  };
}

function scopePlanningPayload(payload, user) {
  if (!user || user.role !== "technician") {
    return payload;
  }

  return {
    ...payload,
    technicians: payload.technicians.filter((tech) => String(tech.id) === String(user.tg_id)),
    jobs: payload.jobs.filter((job) => String(job.technician_id) === String(user.tg_id)),
    week: payload.week
      ? {
          ...payload.week,
          totals: payload.week.totals.filter((item) => String(item.technician_id) === String(user.tg_id)),
        }
      : null,
  };
}

function scopeJobDetailPayload(payload, user) {
  if (!payload) {
    return payload;
  }

  if (user?.role === "technician" && Number(payload.technician_id) !== Number(user.tg_id)) {
    return null;
  }

  const canSeeFinance = canViewFinance(user);
  const canAssignJob = canAssign(user);

  return {
    ...payload,
    finance: canSeeFinance
      ? payload.finance
      : {
          status: "Geen toegang",
          method: "-",
          invoice: "-",
          amount_excl_vat: "-",
          receiver: "-",
        },
    finance_locked: !canSeeFinance,
    actions: {
      assign_label: canAssignJob ? payload.actions?.assign_label || "Assign technician" : null,
      status_label:
        user?.role === "technician" ? "Update eigen status" : payload.actions?.status_label || "Change status",
      status_value: payload.actions?.status_value,
      status_options: (payload.actions?.status_options || []).filter((option) =>
        getAllowedStatusValues(user).includes(option.value)
      ),
      technician_value: payload.actions?.technician_value ?? null,
      assignment_options: canAssignJob ? payload.actions?.assignment_options || [] : [],
    },
  };
}

function canUpdateStatus(user, payload) {
  if (!user || !payload) {
    return false;
  }

  if (user.role === "admin" || user.role === "dispatcher") {
    return true;
  }

  return user.role === "technician" && Number(payload.technician_id) === Number(user.tg_id);
}

function getAllowedStatusValues(user) {
  if (user?.role === "technician") {
    return ["assigned", "on_the_way", "in_progress", "completed"];
  }

  return ["new", "waiting_dispatcher", "assigned", "on_the_way", "in_progress", "completed", "cancelled"];
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
  const currentUser = payload.currentUser || null;
  const currentPreferences = payload.currentPreferences || sanitizePreferences();
  const t = createTranslator(currentPreferences.language);
  return {
    pageTitle,
    activeNav,
    billitBaseUrl: settings.billitBaseUrl,
    currentPath: activeNav,
    navigation: filterNavigationForUser(navigation, currentUser).map((item) => ({
      ...item,
      label: t(item.labelKey, item.fallbackLabel),
    })),
    dbError,
    contentClass,
    rightPanel,
    actions,
    currentUser,
    currentPreferences,
    extraStyles,
    extraScripts,
    t,
    serialize: (value) => JSON.stringify(value ?? []),
    ...payload,
  };
}

function renderPlaceholder(res, key, title, description, currentUser, currentPreferences, statusCode = 200) {
  res.status(statusCode);
  res.render(
    "dispatcher/placeholder",
    baseViewModel({
      pageTitle: title,
      activeNav: key,
      title,
      description,
      actions: [],
      currentUser,
      currentPreferences,
    })
  );
}

function requireNavAccess(key) {
  return (req, res, next) => {
    if (canAccessNav(req.authUser, key)) {
      next();
      return;
    }

    renderPlaceholder(res, key, "Geen toegang", "Je hebt geen toegang tot deze module.", req.authUser, req.userPreferences, 403);
  };
}

async function loadUsersPageData() {
  const [users, technicians] = await Promise.all([listAuthUsers(), fetchPlanningTechnicians()]);

  return {
    users,
    technicians: technicians.map((technician) => ({
      id: technician.tg_id,
      tech_key: technician.tech_key,
      name: technician.full_name,
      role: technician.role,
    })),
    builtInUsers: [
      { username: settings.adminUser, name: settings.adminName, role: "admin" },
      { username: settings.dispatcherUser, name: settings.dispatcherName, role: "dispatcher" },
    ],
  };
}

function buildDashboardLayout(preferences) {
  const dashboard = preferences?.dashboard || sanitizePreferences().dashboard;
  return {
    visible: dashboard.visible,
    slots: dashboard.slots,
  };
}

app.get("/", (req, res) => {
  res.redirect(req.authUser ? "/dispatcher/dashboard" : "/login");
});

app.get("/dispatcher", (req, res) => {
  res.redirect(req.authUser ? "/dispatcher/dashboard" : "/login");
});

app.get("/login", (req, res) => {
  if (req.authUser) {
    res.redirect("/dispatcher/dashboard");
    return;
  }

  res.render("auth/login", {
    error: null,
    nextPath: String(req.query.next || "/dispatcher/dashboard"),
  });
});

app.post("/login", async (req, res) => {
  const nextPath = String(req.body.next || "/dispatcher/dashboard");
  const user = await authenticateCredentials(req.body.username, req.body.password);

  if (!user) {
    res.status(401).render("auth/login", {
      error: "Login mislukt. Controleer gebruikersnaam en wachtwoord.",
      nextPath,
    });
    return;
  }

  res.setHeader("Set-Cookie", buildSetCookieHeader(user, { remember: isRememberRequested(req.body.remember) }));
  res.redirect(nextPath.startsWith("/") ? nextPath : "/dispatcher/dashboard");
});

app.get("/register", (req, res) => {
  res.render("auth/register", {
    error: null,
    success: null,
  });
});

app.post("/register", async (req, res) => {
  try {
    await registerAccount({
      username: req.body.username,
      password: req.body.password,
      fullName: req.body.full_name,
      role: req.body.role,
      techKey: req.body.tech_key,
      setupCode: req.body.setup_code,
    });

    res.render("auth/register", {
      error: null,
      success: "Login aangemaakt. Je kunt nu inloggen.",
    });
  } catch (error) {
    res.status(400).render("auth/register", {
      error: error.message || String(error),
      success: null,
    });
  }
});

app.get("/reset-password", (req, res) => {
  res.render("auth/reset-password", {
    error: null,
    success: null,
    isAdmin: Boolean(req.authUser?.role === "admin"),
  });
});

app.post("/reset-password", async (req, res) => {
  try {
    await resetPassword({
      username: req.body.username,
      password: req.body.password,
      resetCode: req.body.reset_code,
      actor: req.authUser,
    });

    res.render("auth/reset-password", {
      error: null,
      success: "Wachtwoord bijgewerkt.",
      isAdmin: Boolean(req.authUser?.role === "admin"),
    });
  } catch (error) {
    res.status(400).render("auth/reset-password", {
      error: error.message || String(error),
      success: null,
      isAdmin: Boolean(req.authUser?.role === "admin"),
    });
  }
});

app.post("/logout", (req, res) => {
  res.setHeader("Set-Cookie", buildClearCookieHeader());
  res.redirect("/login");
});

app.get("/dispatcher/dashboard", requireAuthPage, requireNavAccess("dashboard"), async (req, res) => {
  const payload = scopeDashboardPayload(await loadDashboardPayload(), req.authUser);
  res.render(
    "dispatcher/dashboard",
    baseViewModel({
      pageTitle: createTranslator(req.userPreferences?.language)("dashboard.title", "Dispatcher dashboard"),
      activeNav: "dashboard",
      contentClass: "content--fullwidth dashboard-content",
      actions: canViewFinance(req.authUser)
        ? [{ href: settings.billitBaseUrl, label: "Open Billit", variant: "ghost", external: true }]
        : [],
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
      dashboardLayout: buildDashboardLayout(req.userPreferences),
      ...payload,
    })
  );
});

app.get("/dispatcher/jobs", requireAuthPage, requireNavAccess("jobs"), async (req, res) => {
  const payload = scopeJobsPayload(await loadJobsPayload(), req.authUser);
  res.render(
    "dispatcher/jobs",
    baseViewModel({
      pageTitle: "Jobs",
      activeNav: "jobs",
      actions: req.authUser?.role === "technician" ? [] : [{ href: "#", label: "+ Job", variant: "primary" }],
      jobs: payload.jobs,
      technicians: payload.technicians,
      filters: payload.filters,
      dbError: payload.db_error,
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
    })
  );
});

app.get("/dispatcher/planning", requireAuthPage, requireNavAccess("planning"), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.render(
    "dispatcher/planning",
    baseViewModel({
      pageTitle: createTranslator(req.userPreferences?.language)("planning.title", "Planning"),
      activeNav: "planning",
      rightPanel: "dispatcher/partials/job_detail_panel",
      extraStyles: ["/static/css/planning.css?v=planning-2"],
      extraScripts: ["/static/js/planning.js?v=planning-2"],
      planning_date: today,
      planning_view: "day",
      actions: [],
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
    })
  );
});

app.get("/dispatcher/calendar", requireAuthPage, requireNavAccess("calendar"), (req, res) => {
  renderPlaceholder(
    res,
    "calendar",
    "Calendar",
    "Calendar wordt in de volgende stap aangesloten op de dispatcherstructuur.",
    serializeUser(req.authUser),
    req.userPreferences
  );
});

app.get("/dispatcher/technicians", requireAuthPage, requireNavAccess("technicians"), (req, res) => {
  renderPlaceholder(
    res,
    "technicians",
    "Technicians",
    "Techniekerbeheer komt op deze pagina zodra de basisstructuur vastligt.",
    serializeUser(req.authUser),
    req.userPreferences
  );
});

app.get("/dispatcher/documents", requireAuthPage, requireNavAccess("documents"), (req, res) => {
  renderPlaceholder(
    res,
    "documents",
    "Documents",
    "Documentcontrole komt hier in een volgende fase.",
    serializeUser(req.authUser),
    req.userPreferences
  );
});

app.get("/dispatcher/finance", requireAuthPage, requireNavAccess("finance"), (req, res) => {
  renderPlaceholder(
    res,
    "finance",
    "Finance",
    "Finance krijgt hier later zijn eigen werkoverzicht.",
    serializeUser(req.authUser),
    req.userPreferences
  );
});

app.get("/dispatcher/users", requireAuthPage, requireNavAccess("users"), async (req, res, next) => {
  try {
    const payload = await loadUsersPageData();
    res.render(
      "dispatcher/users",
      baseViewModel({
        pageTitle: "Users",
        activeNav: "users",
        currentUser: serializeUser(req.authUser),
        currentPreferences: req.userPreferences,
        success: req.query.success || null,
        formError: null,
        formValues: {
          username: "",
          full_name: "",
          role: "dispatcher",
          tech_key: "",
        },
        ...payload,
      })
    );
  } catch (error) {
    next(error);
  }
});

app.post("/dispatcher/users/create", requireAuthPage, requireNavAccess("users"), async (req, res, next) => {
  try {
    await adminCreateUser({
      username: req.body.username,
      password: req.body.password,
      fullName: req.body.full_name,
      role: req.body.role,
      techKey: req.body.tech_key,
    });

    res.redirect("/dispatcher/users?success=Login aangemaakt");
  } catch (error) {
    try {
      const payload = await loadUsersPageData();
      res.status(400).render(
        "dispatcher/users",
        baseViewModel({
          pageTitle: "Users",
          activeNav: "users",
          currentUser: serializeUser(req.authUser),
          currentPreferences: req.userPreferences,
          success: null,
          formError: error.message || String(error),
          formValues: {
            username: String(req.body.username || ""),
            full_name: String(req.body.full_name || ""),
            role: String(req.body.role || "dispatcher"),
            tech_key: String(req.body.tech_key || ""),
          },
          ...payload,
        })
      );
    } catch (nestedError) {
      next(nestedError);
    }
  }
});

app.post("/dispatcher/users/:username/reset", requireAuthPage, requireNavAccess("users"), async (req, res, next) => {
  try {
    await resetPassword({
      username: req.params.username,
      password: req.body.password,
      actor: req.authUser,
    });
    res.redirect("/dispatcher/users?success=Wachtwoord bijgewerkt");
  } catch (error) {
    next(error);
  }
});

app.post("/dispatcher/users/:username/toggle", requireAuthPage, requireNavAccess("users"), async (req, res, next) => {
  try {
    await adminToggleUserActive({
      username: req.params.username,
      actor: req.authUser,
    });
    res.redirect("/dispatcher/users?success=Gebruikersstatus bijgewerkt");
  } catch (error) {
    next(error);
  }
});

app.get("/dispatcher/settings", requireAuthPage, requireNavAccess("settings"), (req, res) => {
  res.render(
    "dispatcher/settings",
    baseViewModel({
      pageTitle: createTranslator(req.userPreferences?.language)("settings.title", "Settings"),
      activeNav: "settings",
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
      success: req.query.success || null,
      settingsValues: req.userPreferences,
    })
  );
});

app.post("/dispatcher/settings", requireAuthPage, requireNavAccess("settings"), async (req, res) => {
  const nextPreferences = sanitizePreferences({
    language: req.body.language,
    dashboard: {
      visible: {
        queue: req.body.visible_queue === "1",
        jobs: req.body.visible_jobs === "1",
        technicians: req.body.visible_technicians === "1",
        appointments: req.body.visible_appointments === "1",
        detail: req.body.visible_detail === "1",
        map: req.body.visible_map === "1",
      },
      slots: {
        left: req.body.slot_left,
        center: req.body.slot_center,
        sideTop: req.body.slot_side_top,
        sideBottom: req.body.slot_side_bottom,
      },
    },
  });

  await saveUserPreferences(req.authUser.username, nextPreferences);
  res.redirect("/dispatcher/settings?success=1");
});

app.get("/api/dashboard", requireAuthApi, async (req, res) => {
  const payload = scopeDashboardPayload(await loadDashboardPayload(), req.authUser);
  res.status(payload.db_error ? 503 : 200).json(payload);
});

app.get("/api/planning", requireAuthApi, async (req, res) => {
  try {
    const payload = scopePlanningPayload(await getPlanningData(req.query.date, req.query.view), req.authUser);
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

app.get("/api/jobs", requireAuthApi, async (req, res) => {
  const payload = scopeJobsPayload(await loadJobsPayload(), req.authUser);
  const jobs = payload.jobs.map((job) => ({
    id: job.id,
    client: job.client,
    city: job.city,
    status: job.status,
    technician: job.technician,
  }));
  res.status(payload.db_error ? 503 : 200).json(jobs);
});

app.get("/api/jobs/:id", requireAuthApi, async (req, res) => {
  const payload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  if (!payload) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(payload);
});

app.post("/api/jobs/:id/status", requireAuthApi, async (req, res) => {
  const payload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  if (!payload) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!canUpdateStatus(req.authUser, payload)) {
    res.status(403).json({ error: "Geen toegang om status te wijzigen" });
    return;
  }

  const nextStatus = String(req.body.status || "").trim();
  if (!getAllowedStatusValues(req.authUser).includes(nextStatus)) {
    res.status(400).json({ error: "Ongeldige status" });
    return;
  }

  await updateJobStatus(req.params.id, nextStatus);
  const updatedPayload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  res.json({ ok: true, job: updatedPayload });
});

app.post("/api/jobs/:id/assign", requireAuthApi, async (req, res) => {
  const payload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  if (!payload) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!canAssign(req.authUser)) {
    res.status(403).json({ error: "Geen toegang om techniekers toe te wijzen" });
    return;
  }

  const rawTechnicianId = String(req.body.technician_id || "").trim();
  const nextTechnicianId = rawTechnicianId ? Number(rawTechnicianId) : null;

  if (rawTechnicianId && !payload.actions?.assignment_options?.some((option) => Number(option.value) === nextTechnicianId)) {
    res.status(400).json({ error: "Onbekende technieker" });
    return;
  }

  await assignJobTechnician(req.params.id, nextTechnicianId);
  const updatedPayload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  res.json({ ok: true, job: updatedPayload });
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
