const express = require("express");
const path = require("path");
const { settings } = require("./config");
const {
  assignJobTechnician,
  autoApplySuggestedAction,
  buildDashboardPayload,
  buildJobsPayload,
  buildJobDetailPayload,
  createOrUpdateSuggestedAction,
  createQuickJob,
  ensureSuggestedActionsSchema,
  addManualTechnician,
  fetchActiveTechnicianLocations,
  fetchAllTelegramUsers,
  fetchPlanningTechnicians,
  fetchSuggestedActionById,
  findJobByChatId,
  FORCE_CONFIRM_INTENTS,
  JOB_CREATE_INTENTS,
  listSuggestedActions,
  SAFE_AUTO_APPLY_INTENTS,
  updateAppointmentCalendarEventId,
  updateJobAppointment,
  updateJobStatus,
  updateSuggestedActionStatus,
  updateTelegramUser,
  removeTechnicianKey,
  upsertTechnicianLocation,
} = require("./repository");
const { getPlanningData } = require("./services/planningService");
const { deleteCalendarEvent, upsertCalendarEvent, fetchUpcomingCalendarEvents } = require("./googleCalendar");
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
  { href: "/dispatcher/kalender", labelKey: "nav.calendar", fallbackLabel: "Kalender", key: "calendar" },
  { href: "/dispatcher/technicians", labelKey: "nav.technicians", fallbackLabel: "Techniekers", key: "technicians" },
  { href: "/dispatcher/documents", labelKey: "nav.documents", fallbackLabel: "Documenten", key: "documents" },
  { href: "/dispatcher/finance", labelKey: "nav.finance", fallbackLabel: "Financiën", key: "finance" },
  { href: "/dispatcher/users", labelKey: "nav.users", fallbackLabel: "Gebruikers", key: "users" },
  { href: "/dispatcher/settings", labelKey: "nav.settings", fallbackLabel: "Instellingen", key: "settings" },
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
    await ensureSuggestedActionsSchema();
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


async function loadSuggestedActions() {
  try {
    // Reprocess any stuck create-job items before loading the list
    await reprocessStuckKarenJobs();
    return await listSuggestedActions(20);
  } catch (error) {
    console.error("[karen] loadSuggestedActions failed:", error.message || String(error));
    throw error;
  }
}

async function reprocessStuckKarenJobs() {
  try {
    const stuck = await listSuggestedActions(50);
    for (const action of stuck) {
      if (action.status !== "new" || action.linked_job_id) continue;
      const isJobCreate = action.intent === "create_urgent_job" || action.intent === "create_scheduled_job";
      if (!isJobCreate) continue;
      try {
        await autoApplySuggestedAction(action.id);
      } catch (error) {
        console.error(`[karen] auto-apply retry failed for action ${action.id}:`, error.message || String(error));
      }
    }
  } catch (error) {
    console.error("[karen] reprocessStuckKarenJobs failed:", error.message || String(error));
    throw error;
  }
}
function canReviewSuggestedActions(user) {
  return Boolean(user && (user.role === "admin" || user.role === "dispatcher"));
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
  const canManageAppointment = canAssign(user);

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
      appointment: canManageAppointment ? payload.actions?.appointment || null : null,
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

function canManageAppointment(user) {
  return canAssign(user);
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
  let suggestedActions = [];
  let suggestedActionsError = null;

  if (canReviewSuggestedActions(req.authUser)) {
    try {
      suggestedActions = await loadSuggestedActions();
    } catch (error) {
      suggestedActionsError = error.message || String(error);
    }
  }

  res.render(
    "dispatcher/dashboard",
    baseViewModel({
      pageTitle: createTranslator(req.userPreferences?.language)("dashboard.title", "Dispatcher dashboard"),
      activeNav: "dashboard",
      contentClass: "content--fullwidth dashboard-content",
      actions: canViewFinance(req.authUser)
        ? [{ href: settings.billitBaseUrl, label: "Open Billit", variant: "ghost", external: true }]
        : [],
      dbError: req.query.db_error || suggestedActionsError || payload.db_error || null,
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
      dashboardLayout: buildDashboardLayout(req.userPreferences),
      suggestedActions,
      success: req.query.success || null,
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
      contentClass: "content--fullwidth jobs-content",
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
      contentClass: "content--fullwidth planning-content",
      extraStyles: ["/static/css/planning.css?v=planning-3"],
      extraScripts: ["/static/js/planning.js?v=planning-3"],
      planning_date: today,
      planning_view: "day",
      actions: [],
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
    })
  );
});

function renderCalendarPage(req, res) {
  res.render(
    "dispatcher/calendar",
    baseViewModel({
      pageTitle: "Kalender",
      activeNav: "calendar",
      contentClass: "content--fullwidth",
      extraStyles: ["/static/css/calendar.css?v=2"],
      extraScripts: ["/static/js/calendar.js?v=2"],
      currentUser: serializeUser(req.authUser),
      currentPreferences: req.userPreferences,
    })
  );
}

app.get("/dispatcher/kalender", requireAuthPage, requireNavAccess("calendar"), renderCalendarPage);
app.get("/dispatcher/calendar",  requireAuthPage, requireNavAccess("calendar"), renderCalendarPage);

app.get("/dispatcher/technicians", requireAuthPage, requireNavAccess("technicians"), async (req, res, next) => {
  try {
    const telegramUsers = await fetchAllTelegramUsers();
    const { CALENDAR_MAP } = require("./googleCalendar");
    const techKeyOptions = Object.keys(CALENDAR_MAP);
    res.render(
      "dispatcher/techniekers",
      baseViewModel({
        pageTitle: "Techniekers",
        activeNav: "technicians",
        currentUser: serializeUser(req.authUser),
        currentPreferences: req.userPreferences,
        success: req.query.success || null,
        error: req.query.error || null,
        telegramUsers,
        techKeyOptions,
      })
    );
  } catch (error) {
    next(error);
  }
});

// Keep old URL working too
app.get("/dispatcher/techniekers", requireAuthPage, requireNavAccess("technicians"), (req, res) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect("/dispatcher/technicians" + qs);
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

// -- Technician management POST routes -------------------------------------

app.post("/dispatcher/technicians/add", requireAuthPage, requireNavAccess("technicians"), async (req, res, next) => {
  try {
    const fullName = String(req.body.full_name || "").trim();
    const techKey = String(req.body.tech_key || "").trim();
    const tgId = req.body.tg_id ? Number(req.body.tg_id) : null;
    if (!fullName || !techKey) {
      res.redirect("/dispatcher/technicians?error=Naam+en+code+zijn+verplicht");
      return;
    }
    await addManualTechnician({ fullName, techKey, tgId });
    res.redirect("/dispatcher/technicians?success=Technieker+toegevoegd");
  } catch (error) {
    next(error);
  }
});

app.post("/dispatcher/technicians/:tgId/update", requireAuthPage, requireNavAccess("technicians"), async (req, res, next) => {
  try {
    const tgId = Number(req.params.tgId);
    const techKey = req.body.tech_key === "" ? null : String(req.body.tech_key || "").trim().toUpperCase() || null;
    const isActive = req.body.is_active === "1";
    await updateTelegramUser({ tgId, techKey, isActive });
    res.redirect("/dispatcher/technicians?success=Technieker+bijgewerkt");
  } catch (error) {
    next(error);
  }
});

app.post("/dispatcher/technicians/:tgId/remove", requireAuthPage, requireNavAccess("technicians"), async (req, res, next) => {
  try {
    await removeTechnicianKey(Number(req.params.tgId));
    res.redirect("/dispatcher/technicians?success=Technieker+verwijderd");
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


app.get("/api/suggested-actions", requireAuthApi, async (req, res) => {
  if (!canReviewSuggestedActions(req.authUser)) {
    res.status(403).json({ error: "Geen toegang" });
    return;
  }

  const actions = await loadSuggestedActions();
  res.json(actions);
});

app.post("/api/karen/suggested-actions", async (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const providedToken = bearerToken || String(req.headers["x-karen-bridge-token"] || "");

  if (!settings.karenBridgeToken || providedToken !== settings.karenBridgeToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = req.body && typeof req.body === "object" ? req.body : {};
  const intent = String(result.intent || "unknown");
  const confidence = Number(result.confidence || 0);

  // Job creation is always assumed correct - no confirmation needed
  // For other intents: try to auto-link via group chat_id
  let linkedJobId = result.linked_job_id ? Number(result.linked_job_id) : null;
  let linkStatus = result.link_status || "unlinked";
  let needsConfirmation = FORCE_CONFIRM_INTENTS.has(intent);

  if (!JOB_CREATE_INTENTS.has(intent) && !linkedJobId && result.source_chat_id) {
    try {
      const job = await findJobByChatId(result.source_chat_id);
      if (job) {
        linkedJobId = job.id;
        linkStatus = "exact";
        // non-financial intents with exact match -> no confirmation
        if (!FORCE_CONFIRM_INTENTS.has(intent)) needsConfirmation = false;
      }
    } catch (_err) {
      // linking failure is non-fatal
    }
  }

  // If there's no linked job AND this isn't a job-creation or financial intent,
  // there's nothing actionable - skip silently rather than cluttering the inbox.
  const isActionable = JOB_CREATE_INTENTS.has(intent) || linkedJobId || FORCE_CONFIRM_INTENTS.has(intent);
  if (!isActionable) {
    res.status(200).json({ ok: true, id: null, auto_applied: false, linked_job_id: null, skipped: true });
    return;
  }

  const row = await createOrUpdateSuggestedAction({
    source_type: result.source_type || "telegram",
    source_chat_id: result.source_chat_id,
    source_message_id: result.source_message_id,
    source_user_id: result.source_user_id,
    intent,
    confidence: result.confidence,
    linked_job_id: linkedJobId,
    linked_card_id: linkedJobId,
    link_status: linkStatus,
    reason_for_confirmation: needsConfirmation ? (result.reason_for_confirmation || null) : null,
    raw_message: result.raw_message,
    parsed_fields: result.parsed_fields || result.fields || {},
    proposed_updates: result.proposed_updates || {},
    needs_confirmation: needsConfirmation,
    status: "new",
  });

  // Auto-apply: job creation intents always, safe update intents when exactly linked
  let autoApplied = false;
  let autoApplyError = null;
  const canAutoApply =
    row?.id &&
    SAFE_AUTO_APPLY_INTENTS.has(intent) &&
    (JOB_CREATE_INTENTS.has(intent) || linkedJobId);

  if (canAutoApply) {
    try {
      autoApplied = Boolean(await autoApplySuggestedAction(row.id));
    } catch (error) {
      autoApplyError = error.message || String(error);
      console.error(`[karen] auto-apply failed for action ${row.id}:`, autoApplyError);
    }
  }

  res.status(201).json({
    ok: true,
    id: row?.id || null,
    auto_applied: autoApplied,
    auto_apply_error: autoApplyError,
    linked_job_id: linkedJobId,
  });
});


app.post("/dispatcher/suggested-actions/:id/confirm", requireAuthPage, requireNavAccess("dashboard"), async (req, res) => {
  if (!canReviewSuggestedActions(req.authUser)) {
    res.status(403).send("Geen toegang");
    return;
  }

  const action = await fetchSuggestedActionById(req.params.id);
  const reviewer = req.authUser?.username || req.authUser?.name || "unknown";

  if (action?.intent === "cancel_job_request" && Number(action?.linked_job_id)) {
    await updateJobStatus(action.linked_job_id, "cancelled");
    await updateSuggestedActionStatus(req.params.id, "applied", reviewer);
  } else {
    await updateSuggestedActionStatus(req.params.id, "confirmed", reviewer);
  }

  res.redirect("/dispatcher/dashboard");
});

app.post("/dispatcher/suggested-actions/:id/reject", requireAuthPage, requireNavAccess("dashboard"), async (req, res) => {
  if (!canReviewSuggestedActions(req.authUser)) {
    res.status(403).send("Geen toegang");
    return;
  }

  await updateSuggestedActionStatus(req.params.id, "rejected", req.authUser?.username || req.authUser?.name || "unknown");
  res.redirect("/dispatcher/dashboard");
});

app.post("/dispatcher/suggested-actions/:id/create-job", requireAuthPage, requireNavAccess("dashboard"), async (req, res) => {
  if (!canReviewSuggestedActions(req.authUser)) {
    res.status(403).send("Geen toegang");
    return;
  }

  const address = String(req.body.address || "").trim();
  if (!address) {
    res.redirect("/dispatcher/dashboard");
    return;
  }

  const reviewer = req.authUser?.username || req.authUser?.name || "unknown";

  try {
    const cardId = await createQuickJob({
      address,
      clientName: String(req.body.client_name || "").trim() || null,
      phone: String(req.body.phone || "").trim() || null,
      category: "Dringend",
      problemType: String(req.body.problem_type || "").trim() || null,
      createdBy: req.authUser?.tg_id || 0,
    });

    await updateSuggestedActionStatus(req.params.id, "applied", reviewer, { linked_card_id: cardId });
    res.redirect("/dispatcher/dashboard?success=Job+aangemaakt");
  } catch (err) {
    console.error("[create-job] mislukt:", err.message);
    res.redirect(`/dispatcher/dashboard?db_error=${encodeURIComponent(err.message)}`);
  }
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

// Google Calendar feed for planning page
app.get("/api/calendar", requireAuthApi, async (req, res) => {
  try {
    const data = await fetchUpcomingCalendarEvents(null, 14);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
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

app.post("/api/jobs/:id/appointment", requireAuthApi, async (req, res) => {
  const payload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);
  if (!payload) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (!canManageAppointment(req.authUser)) {
    res.status(403).json({ error: "Geen toegang om afspraken te wijzigen" });
    return;
  }

  const scheduledAt = String(req.body.scheduled_at || "").trim();
  const afspraakType = String(req.body.afspraak_type || "").trim();
  const appointmentStatus = String(req.body.status || "").trim();

  if (!scheduledAt) {
    res.status(400).json({ error: "Afspraakdatum is verplicht" });
    return;
  }

  if (!payload.actions?.appointment?.type_options?.some((option) => option.value === afspraakType)) {
    res.status(400).json({ error: "Ongeldig afspraaktype" });
    return;
  }

  if (!payload.actions?.appointment?.status_options?.some((option) => option.value === appointmentStatus)) {
    res.status(400).json({ error: "Ongeldige afspraakstatus" });
    return;
  }

  const appointment = await updateJobAppointment(req.params.id, {
    scheduledAt: scheduledAt.replace("T", " ") + ":00",
    afspraakType,
    status: appointmentStatus,
  });

  const updatedPayload = scopeJobDetailPayload(await buildJobDetailPayload(req.params.id), req.authUser);

  // Sync to Google Calendar if a technician is assigned
  const techKey = updatedPayload?.tech_key || null;
  if (techKey) {
    const calendarEventId = appointment?.calendar_event_id || null;
    if (appointmentStatus === "cancelled") {
      if (calendarEventId) {
        await deleteCalendarEvent({ techKey, eventId: calendarEventId });
        await updateAppointmentCalendarEventId(appointment.id, null);
      }
    } else {
      const addr = updatedPayload?.address === "-" ? "" : updatedPayload?.address || "";
      const clientName = updatedPayload?.client === "-" ? "" : updatedPayload?.client || "";
      const problemType = updatedPayload?.problem === "-" ? "" : updatedPayload?.problem || "";
      const nextCalendarEventId = await upsertCalendarEvent({
        techKey,
        eventId: calendarEventId,
        title: `#${req.params.id} – ${problemType || "Interventie"}`,
        description: `Klant: ${clientName}\nAdres: ${addr}\nType: ${afspraakType}`,
        address: addr,
        scheduledAt,
      });
      if (appointment?.id && nextCalendarEventId && nextCalendarEventId !== calendarEventId) {
        await updateAppointmentCalendarEventId(appointment.id, nextCalendarEventId);
      }
    }
  }

  res.json({ ok: true, job: updatedPayload });
});

// -- Quick job creation ------------------------------------------------------
app.post("/api/jobs", requireAuthApi, async (req, res) => {
  if (!canAssign(req.authUser)) {
    res.status(403).json({ error: "Geen toegang" });
    return;
  }

  const address = String(req.body.address || "").trim();
  if (!address) {
    res.status(400).json({ error: "Adres is verplicht" });
    return;
  }

  try {
    const cardId = await createQuickJob({
      address,
      clientName: String(req.body.client_name || "").trim() || null,
      phone: String(req.body.phone || "").trim() || null,
      category: String(req.body.category || "Dringend").trim(),
      problemType: String(req.body.problem_type || "").trim() || null,
      createdBy: req.authUser?.tg_id || 0,
    });
    res.status(201).json({ ok: true, card_id: cardId });
  } catch (err) {
    res.status(500).json({ error: err.message || "Aanmaken mislukt" });
  }
});
// -- Technician live locations -----------------------------------------------

// POST from Telegram bot when a technician shares location in the general group
app.post("/api/locations", async (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!settings.karenBridgeToken || token !== settings.karenBridgeToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { tg_id, full_name, latitude, longitude, accuracy } = req.body || {};
  if (!tg_id || latitude == null || longitude == null) {
    res.status(400).json({ error: "tg_id, latitude en longitude zijn verplicht" });
    return;
  }
  try {
    await upsertTechnicianLocation({ tgId: tg_id, fullName: full_name, latitude, longitude, accuracy });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET for the mini-map - returns locations updated in last 2 hours
app.get("/api/locations", requireAuthApi, async (req, res) => {
  try {
    const locations = await fetchActiveTechnicianLocations();
    res.json(locations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------

// -- Telegram Mini App -------------------------------------------------------
const crypto = require("crypto");

function validateTelegramInitData(initData) {
  if (!settings.botToken || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(settings.botToken).digest();
    const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (expectedHash !== hash) return null;

    const userRaw = params.get("user");
    return userRaw ? JSON.parse(userRaw) : null;
  } catch (_err) {
    return null;
  }
}

app.get("/tma", async (req, res) => {
  res.render("tma/shell", {
    pageTitle: "Mini App",
    currentUser: req.authUser ? serializeUser(req.authUser) : null,
    botTokenConfigured: Boolean(settings.botToken),
  });
});

app.post("/api/tma/auth", async (req, res) => {
  const initData = String(req.body.init_data || "");
  const tgUser = validateTelegramInitData(initData);

  if (!tgUser) {
    res.status(401).json({ error: "Ongeldige Telegram-verificatie" });
    return;
  }

  // Look up technician by tg_id
  const { fetchUserById } = require("./repository");
  const technician = await fetchUserById(tgUser.id);

  if (!technician) {
    res.status(403).json({ error: "Geen toegang: je Telegram-account is niet gekoppeld aan een technieker." });
    return;
  }

  const user = {
    username: technician.tech_key || String(tgUser.id),
    name: technician.full_name || tgUser.first_name,
    role: "technician",
    tg_id: technician.tg_id,
    tech_key: technician.tech_key,
  };

  res.setHeader("Set-Cookie", buildSetCookieHeader(user, { remember: true }));
  res.json({ ok: true, user: serializeUser(user) });
});
// ----------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({ ok: true, app: settings.appName });
});

if (require.main === module) {
  app.listen(settings.port, () => {
    console.log(`Node mini app draait op http://127.0.0.1:${settings.port}`);
  });
}

module.exports = { app };

