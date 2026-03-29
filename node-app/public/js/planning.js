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
  };

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
    return date.toLocaleTimeString("nl-BE", {
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

    technicianFilter.innerHTML = `<option value="">All technicians</option>${technicians
      .map((tech) => `<option value="${tech.id}">${tech.name}</option>`)
      .join("")}`;
    technicianFilter.value = state.technicianFilter;

    regionFilter.innerHTML = `<option value="">All regions</option>${regions
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
    header.innerHTML = technicians
      .map(
        (tech) => `
          <div class="planning-tech-header">
            <strong>${tech.name}</strong>
            <span class="muted">${tech.status} · ${tech.region}</span>
          </div>
        `
      )
      .join("");
  }

  function renderGrid() {
    const dayView = document.getElementById("planningDayView");
    const weekPlaceholder = document.getElementById("planningWeekPlaceholder");
    const label = document.getElementById("planningViewLabel");

    if (!state.payload) {
      return;
    }

    label.textContent = state.view === "week" ? "Week overview" : "Day view";

    if (state.view === "week") {
      dayView.classList.add("hidden");
      weekPlaceholder.classList.remove("hidden");

      const totals = state.payload.week?.totals || [];
      weekPlaceholder.innerHTML = `
        <p class="muted">${state.payload.week?.message || "Week view volgt later."}</p>
        <div class="week-summary">
          ${totals
            .map(
              (item) => `
                <div class="week-card">
                  <strong>${item.name}</strong>
                  <p>${item.jobs} jobs deze week</p>
                </div>
              `
            )
            .join("")}
        </div>
      `;
      return;
    }

    dayView.classList.remove("hidden");
    weekPlaceholder.classList.add("hidden");

    const technicians = visibleTechnicians();
    const jobs = visibleJobs();
    const grid = document.getElementById("planningGrid");
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
            <strong>#${job.id} · ${job.client}</strong>
            <small>${formatTime(job.start)} - ${formatTime(job.end)}</small>
            <small>${job.city}</small>
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
