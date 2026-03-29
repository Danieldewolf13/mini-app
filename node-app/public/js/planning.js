(function planningModule() {
  if (window.MINI_APP_DATA?.currentPath !== "planning") {
    return;
  }

  const START_HOUR = 8;
  const END_HOUR = 20;
  const SLOT_MINUTES = 30;
  const SLOT_HEIGHT = 44;
  const totalSlots = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

  const state = {
    date: window.MINI_APP_DATA.planningDate || new Date().toISOString().slice(0, 10),
    view: window.MINI_APP_DATA.planningView || "day",
    payload: null,
    technicianFilter: "",
    regionFilter: "",
    language: window.MINI_APP_DATA.currentLanguage || "nl",
  };

  const localeByLanguage = {
    nl: "nl-BE",
    en: "en-GB",
    fr: "fr-BE",
    ru: "ru-RU",
  };

  const copy = {
    nl: {
      allTechnicians: "Alle techniekers",
      allRegions: "Alle regio's",
      dayView: "Dagoverzicht",
      weekView: "Weekoverzicht",
      weekPending: "Weekweergave wordt binnenkort verder uitgebreid.",
      weekJobs: "jobs deze week",
      techBusy: "bezet",
      techAvailable: "vrij",
      unassigned: "Niet toegewezen",
    },
    en: {
      allTechnicians: "All technicians",
      allRegions: "All regions",
      dayView: "Day view",
      weekView: "Week overview",
      weekPending: "Week view will be expanded soon.",
      weekJobs: "jobs this week",
      techBusy: "busy",
      techAvailable: "free",
      unassigned: "Unassigned",
    },
    fr: {
      allTechnicians: "Tous les techniciens",
      allRegions: "Toutes les regions",
      dayView: "Vue jour",
      weekView: "Vue semaine",
      weekPending: "La vue semaine sera bientot plus detaillee.",
      weekJobs: "jobs cette semaine",
      techBusy: "occupe",
      techAvailable: "libre",
      unassigned: "Non assigne",
    },
    ru: {
      allTechnicians: "\u0412\u0441\u0435 \u0442\u0435\u0445\u043d\u0438\u043a\u0438",
      allRegions: "\u0412\u0441\u0435 \u0440\u0435\u0433\u0438\u043e\u043d\u044b",
      dayView: "\u0414\u0435\u043d\u044c",
      weekView: "\u041d\u0435\u0434\u0435\u043b\u044f",
      weekPending: "\u041d\u0435\u0434\u0435\u043b\u044c\u043d\u044b\u0439 \u0432\u0438\u0434 \u0441\u043a\u043e\u0440\u043e \u0441\u0442\u0430\u043d\u0435\u0442 \u043f\u043e\u0434\u0440\u043e\u0431\u043d\u0435\u0435.",
      weekJobs: "\u0437\u0430\u0434\u0430\u0447 \u0437\u0430 \u043d\u0435\u0434\u0435\u043b\u044e",
      techBusy: "\u0437\u0430\u043d\u044f\u0442",
      techAvailable: "\u0441\u0432\u043e\u0431\u043e\u0434\u0435\u043d",
      unassigned: "\u0411\u0435\u0437 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u044f",
    },
  };

  function t(key) {
    const language = state.language in copy ? state.language : "nl";
    return copy[language][key] || copy.nl[key] || key;
  }

  function minutesSinceStart(value) {
    const date = new Date(value);
    return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
  }

  function slotTop(value) {
    return (minutesSinceStart(value) / SLOT_MINUTES) * SLOT_HEIGHT;
  }

  function slotHeight(start, end) {
    const startMinutes = minutesSinceStart(start);
    const endMinutes = minutesSinceStart(end);
    const duration = Math.max(endMinutes - startMinutes, 60);
    return (duration / SLOT_MINUTES) * SLOT_HEIGHT;
  }

  function formatTime(value) {
    const date = new Date(value);
    return date.toLocaleTimeString(localeByLanguage[state.language] || "nl-BE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function visibleTechnicians() {
    const technicians = state.payload?.technicians || [];
    if (!state.technicianFilter) {
      return technicians;
    }
    return technicians.filter((tech) => String(tech.id) === String(state.technicianFilter));
  }

  function visibleJobs() {
    const jobs = state.payload?.jobs || [];
    return jobs.filter((job) => {
      const techMatch = !state.technicianFilter || String(job.technician_id) === String(state.technicianFilter);
      const regionMatch = !state.regionFilter || String(job.region) === String(state.regionFilter);
      return techMatch && regionMatch;
    });
  }

  function renderFilters() {
    const technicianFilter = document.getElementById("planningTechnicianFilter");
    const regionFilter = document.getElementById("planningRegionFilter");

    const technicians = state.payload?.technicians || [];
    const regions = [...new Set((state.payload?.jobs || []).map((job) => job.region).filter(Boolean))].sort();

    technicianFilter.innerHTML = `<option value="">${t("allTechnicians")}</option>${technicians
      .map((tech) => `<option value="${tech.id}">${tech.name}</option>`)
      .join("")}`;
    technicianFilter.value = state.technicianFilter;

    regionFilter.innerHTML = `<option value="">${t("allRegions")}</option>${regions
      .map((region) => `<option value="${region}">${region}</option>`)
      .join("")}`;
    regionFilter.value = state.regionFilter;
  }

  function renderTimeSidebar() {
    const timeSidebar = document.getElementById("planningTimeSidebar");
    timeSidebar.innerHTML = "";

    for (let slot = 0; slot < totalSlots; slot += 1) {
      const minutes = START_HOUR * 60 + slot * SLOT_MINUTES;
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const minute = String(minutes % 60).padStart(2, "0");
      const item = document.createElement("div");
      item.className = "planning-time-slot";
      item.textContent = `${hour}:${minute}`;
      timeSidebar.appendChild(item);
    }
  }

  function renderHeaders(technicians) {
    const header = document.getElementById("planningHeaderTechnicians");
    header.style.setProperty("--planning-columns", String(Math.max(technicians.length, 1)));
    const jobs = visibleJobs();
    header.innerHTML = technicians
      .map((tech) => {
        const techJobs = jobs.filter((job) => String(job.technician_id) === String(tech.id));
        const busyRatio = Math.min(techJobs.length / 4, 1);
        const statusLabel =
          tech.status === "busy"
            ? t("techBusy")
            : tech.status === "available"
              ? t("techAvailable")
              : tech.status;

        return `
          <div class="planning-tech-header">
            <div class="planning-tech-header-top">
              <strong>${tech.name}</strong>
              <span class="planning-tech-count">${techJobs.length}</span>
            </div>
            <div class="planning-tech-progress">
              <span style="width:${busyRatio * 100}%"></span>
            </div>
            <span class="muted">${statusLabel} - ${tech.region}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderWeekPlaceholder(weekPayload) {
    const totals = weekPayload?.totals || [];
    return `
      <p class="muted">${weekPayload?.message || t("weekPending")}</p>
      <div class="week-summary">
        ${totals
          .map(
            (item) => `
              <div class="week-card">
                <strong>${item.name}</strong>
                <p>${item.jobs} ${t("weekJobs")}</p>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderGrid() {
    const dayView = document.getElementById("planningDayView");
    const weekPlaceholder = document.getElementById("planningWeekPlaceholder");
    const label = document.getElementById("planningViewLabel");

    if (!state.payload) {
      return;
    }

    label.textContent = state.view === "week" ? t("weekView") : t("dayView");

    if (state.view === "week") {
      dayView.classList.add("hidden");
      weekPlaceholder.classList.remove("hidden");
      weekPlaceholder.innerHTML = renderWeekPlaceholder(state.payload.week);
      return;
    }

    dayView.classList.remove("hidden");
    weekPlaceholder.classList.add("hidden");

    const technicians = visibleTechnicians();
    const jobs = visibleJobs();
    const grid = document.getElementById("planningGrid");
    const main = document.getElementById("planningMain");
    grid.style.setProperty("--planning-columns", String(Math.max(technicians.length, 1)));
    renderHeaders(technicians);
    renderTimeSidebar();

    grid.innerHTML = "";

    technicians.forEach((tech) => {
      const column = document.createElement("div");
      column.className = "planning-column";
      column.style.setProperty("--planning-grid-height", `${totalSlots * SLOT_HEIGHT}px`);

      for (let slot = 0; slot < totalSlots; slot += 1) {
        const slotNode = document.createElement("div");
        slotNode.className = "planning-slot";
        column.appendChild(slotNode);
      }

      jobs
        .filter((job) => String(job.technician_id) === String(tech.id))
        .forEach((job) => {
          const block = document.createElement("button");
          block.type = "button";
          block.className = `job-block status-${job.status}`;
          if (job.urgent) {
            block.classList.add("is-urgent");
          }
          if (job.overdue) {
            block.classList.add("is-overdue");
          }
          block.style.top = `${slotTop(job.start)}px`;
          block.style.height = `${slotHeight(job.start, job.end)}px`;
          block.dataset.jobId = job.id;
          block.innerHTML = `
            <span class="job-block-accent"></span>
            <strong>#${job.id} - ${job.client}</strong>
            <small>${job.title}</small>
            <small>${formatTime(job.start)} - ${formatTime(job.end)} - ${job.city || t("unassigned")}</small>
          `;
          block.addEventListener("click", () => {
            if (typeof window.loadJobDetail === "function") {
              window.loadJobDetail(job.id);
            }
          });
          column.appendChild(block);
        });

      grid.appendChild(column);
    });

    if (main) {
      main.scrollLeft = 0;
    }
  }

  async function loadPlanningData() {
    const response = await fetch(`/api/planning?date=${state.date}&view=${state.view}`);
    state.payload = await response.json();
    renderFilters();
    renderGrid();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll("[data-view-switch]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewSwitch === view);
    });
    loadPlanningData();
  }

  function shiftDate(amount) {
    const date = new Date(`${state.date}T00:00:00`);
    date.setDate(date.getDate() + amount);
    state.date = date.toISOString().slice(0, 10);
    document.getElementById("planningDate").value = state.date;
    loadPlanningData();
  }

  function bindToolbar() {
    document.getElementById("planningTodayBtn")?.addEventListener("click", () => {
      state.date = new Date().toISOString().slice(0, 10);
      document.getElementById("planningDate").value = state.date;
      loadPlanningData();
    });

    document.getElementById("planningPrevBtn")?.addEventListener("click", () => shiftDate(state.view === "week" ? -7 : -1));
    document.getElementById("planningNextBtn")?.addEventListener("click", () => shiftDate(state.view === "week" ? 7 : 1));

    document.getElementById("planningDate")?.addEventListener("change", (event) => {
      state.date = event.target.value;
      loadPlanningData();
    });

    document.querySelectorAll("[data-view-switch]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.viewSwitch));
    });

    document.getElementById("planningTechnicianFilter")?.addEventListener("change", (event) => {
      state.technicianFilter = event.target.value;
      renderGrid();
    });

    document.getElementById("planningRegionFilter")?.addEventListener("change", (event) => {
      state.regionFilter = event.target.value;
      renderGrid();
    });
  }

  bindToolbar();
  loadPlanningData();
})();
