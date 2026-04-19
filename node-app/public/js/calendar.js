(function calendarModule() {
  if (window.MINI_APP_DATA?.currentPath !== "calendar") return;

  const state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0-based
    techFilter: "",
    appointments: [],   // from DB via /api/planning (multiple days)
    calEvents: [],      // from Google Calendar /api/calendar
    technicians: [],
  };

  // ── helpers ──────────────────────────────────────────────────────────────

  function dateKey(d) {
    return d.toISOString().slice(0, 10);
  }

  function parseDate(str) {
    if (!str) return null;
    // handles "2026-04-20T08:00:00" and "2026-04-20"
    return new Date(str.includes("T") ? str : str + "T00:00:00");
  }

  function fmtTime(str) {
    const d = parseDate(str);
    if (!d) return "";
    return d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(d) {
    return d.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  // ── data loading ─────────────────────────────────────────────────────────

  async function loadData() {
    // fetch planning data for the whole month (first → last day)
    const firstDay = new Date(state.year, state.month, 1);
    const lastDay  = new Date(state.year, state.month + 1, 0);
    const startStr = dateKey(firstDay);
    const endStr   = dateKey(lastDay);

    const [planResp, calResp] = await Promise.all([
      fetch(`/api/planning?date=${startStr}&view=week&start=${startStr}&end=${endStr}`).catch(() => null),
      fetch("/api/calendar").catch(() => null),
    ]);

    if (planResp?.ok) {
      const data = await planResp.json();
      state.appointments = data.jobs || [];
      state.technicians  = data.technicians || [];
      populateTechFilter(state.technicians);
    }

    if (calResp?.ok) {
      state.calEvents = await calResp.json();
    }

    render();
  }

  function populateTechFilter(technicians) {
    const sel = document.getElementById("calTechFilter");
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    technicians.forEach((t) => {
      if (!existing.has(String(t.id))) {
        const opt = document.createElement("option");
        opt.value = String(t.id);
        opt.textContent = t.name;
        sel.appendChild(opt);
      }
    });
  }

  // ── build day-event index ─────────────────────────────────────────────────

  function buildDayIndex() {
    const index = {}; // key: "YYYY-MM-DD" → { jobs: [], gcal: [] }

    state.appointments.forEach((job) => {
      if (!job.start) return;
      if (state.techFilter && String(job.technician_id) !== state.techFilter) return;
      const key = dateKey(parseDate(job.start));
      if (!index[key]) index[key] = { jobs: [], gcal: [] };
      index[key].jobs.push(job);
    });

    state.calEvents.forEach((entry) => {
      (entry.events || []).forEach((evt) => {
        if (!evt.start) return;
        const key = dateKey(parseDate(evt.start));
        if (!index[key]) index[key] = { jobs: [], gcal: [] };
        index[key].gcal.push({ ...evt, techKey: entry.techKey });
      });
    });

    return index;
  }

  // ── render calendar grid ─────────────────────────────────────────────────

  const DAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];

  function render() {
    const grid = document.getElementById("calGrid");
    const label = document.getElementById("calMonthLabel");
    if (!grid || !label) return;

    const firstDay  = new Date(state.year, state.month, 1);
    const lastDay   = new Date(state.year, state.month + 1, 0);
    const monthName = firstDay.toLocaleDateString("nl-BE", { month: "long", year: "numeric" });
    label.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const index = buildDayIndex();
    const todayKey = dateKey(new Date());

    // Start on Monday (isoWeekday)
    let startOffset = firstDay.getDay() - 1; // 0=Mon
    if (startOffset < 0) startOffset = 6;

    grid.innerHTML = "";

    // Header row
    DAYS.forEach((d) => {
      const hdr = document.createElement("div");
      hdr.className = "cal-header-cell";
      hdr.textContent = d;
      grid.appendChild(hdr);
    });

    // Empty cells before first day
    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-cell cal-cell--empty";
      grid.appendChild(empty);
    }

    // Day cells
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d   = new Date(state.year, state.month, day);
      const key = dateKey(d);
      const dayData = index[key] || { jobs: [], gcal: [] };
      const total = dayData.jobs.length + dayData.gcal.length;

      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (key === todayKey) cell.classList.add("cal-cell--today");
      if (total > 0) cell.classList.add("cal-cell--has-events");

      cell.innerHTML = `
        <span class="cal-day-num">${day}</span>
        ${dayData.jobs.length ? `<span class="cal-dot cal-dot--job" title="${dayData.jobs.length} job(s)">${dayData.jobs.length}</span>` : ""}
        ${dayData.gcal.length ? `<span class="cal-dot cal-dot--gcal" title="${dayData.gcal.length} agenda">${dayData.gcal.length}</span>` : ""}
      `;

      cell.addEventListener("click", () => showDay(d, dayData));
      grid.appendChild(cell);
    }
  }

  // ── day detail panel ────────────────────────────────────────────────────

  function showDay(date, dayData) {
    const dateLabel = document.getElementById("calDetailDate");
    const items     = document.getElementById("calDetailItems");
    if (!dateLabel || !items) return;

    // Highlight selected cell
    document.querySelectorAll(".cal-cell--selected").forEach((c) => c.classList.remove("cal-cell--selected"));
    const key = dateKey(date);
    document.querySelectorAll(".cal-cell").forEach((c) => {
      if (c.querySelector(".cal-day-num")?.textContent == date.getDate()) {
        c.classList.add("cal-cell--selected");
      }
    });

    dateLabel.textContent = fmtDay(date);

    if (!dayData.jobs.length && !dayData.gcal.length) {
      items.innerHTML = `<p class="empty-state">Geen afspraken op deze dag.</p>`;
      return;
    }

    let html = "";

    dayData.jobs.forEach((job) => {
      html += `
        <div class="cal-item cal-item--job">
          <div class="cal-item-time">${fmtTime(job.start)}${job.end ? " – " + fmtTime(job.end) : ""}</div>
          <div class="cal-item-body">
            <strong>#${job.id} – ${job.client || ""}</strong>
            <span>${job.title || ""}</span>
            <span class="cal-item-tech">${job.technician_name || ""}</span>
          </div>
        </div>`;
    });

    dayData.gcal.forEach((evt) => {
      html += `
        <div class="cal-item cal-item--gcal">
          <div class="cal-item-time">${fmtTime(evt.start)}${evt.end ? " – " + fmtTime(evt.end) : ""}</div>
          <div class="cal-item-body">
            <strong>${evt.title || "Afspraak"}</strong>
            ${evt.location ? `<span>📍 ${evt.location}</span>` : ""}
            <span class="cal-item-tech">📅 ${evt.techKey || ""}</span>
          </div>
        </div>`;
    });

    items.innerHTML = html;
  }

  // ── toolbar bindings ─────────────────────────────────────────────────────

  document.getElementById("calPrevMonth")?.addEventListener("click", () => {
    state.month--;
    if (state.month < 0) { state.month = 11; state.year--; }
    loadData();
  });

  document.getElementById("calNextMonth")?.addEventListener("click", () => {
    state.month++;
    if (state.month > 11) { state.month = 0; state.year++; }
    loadData();
  });

  document.getElementById("calTodayBtn")?.addEventListener("click", () => {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth();
    loadData();
  });

  document.getElementById("calTechFilter")?.addEventListener("change", (e) => {
    state.techFilter = e.target.value;
    render();
  });

  loadData();
})();
