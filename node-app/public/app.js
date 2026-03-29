const dashboardData = window.MINI_APP_DATA || {};
const jobs = dashboardData.jobs || [];

let map;
let focusMarker;
const defaultMapView = { center: [50.85, 4.35], zoom: 8 };
let mapInteractionEnabled = false;

function setupSidebarToggle() {
  const toggle = document.getElementById("sidebarToggle");
  const shell = document.querySelector(".app-shell");

  if (!toggle || !shell) {
    return;
  }

  const storageKey = "mini-app-sidebar-collapsed";

  function applyState(collapsed) {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) {
      applyState(window.innerWidth <= 900);
    } else {
      applyState(stored === "1");
    }
  } catch (error) {
    applyState(window.innerWidth <= 900);
  }

  toggle.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    applyState(collapsed);
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch (error) {
      // ignore storage issues and keep UI functional
    }
  });
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function syncSearchInputs(value) {
  const localSearch = document.querySelector("#job-search");
  const globalSearch = document.querySelector("#global-search");

  if (localSearch && localSearch !== document.activeElement) {
    localSearch.value = value;
  }
  if (globalSearch && globalSearch !== document.activeElement) {
    globalSearch.value = value;
  }
}

function filterJobCards() {
  const localSearch = document.querySelector("#job-search");
  const globalSearch = document.querySelector("#global-search");
  const statusFilter = document.querySelector("#status-filter");
  const technicianFilter = document.querySelector("#technician-filter");
  const dateFilter = document.querySelector("#date-filter");
  const visibleCount = document.querySelector("[data-visible-count]");
  const cards = Array.from(document.querySelectorAll(".job-card"));

  if (!cards.length) {
    return;
  }

  const query = normalize(localSearch?.value || globalSearch?.value);
  const selectedStatus = normalize(statusFilter?.value);
  const selectedTechnician = normalize(technicianFilter?.value);
  const selectedDate = normalize(dateFilter?.value);

  let visible = 0;
  const now = new Date();

  cards.forEach((card) => {
    const matchesQuery = !query || normalize(card.dataset.search).includes(query);
    const matchesStatus = !selectedStatus || normalize(card.dataset.status) === selectedStatus;
    const matchesTechnician = !selectedTechnician || normalize(card.dataset.technician) === selectedTechnician;

    let matchesDate = true;
    if (selectedDate) {
      const job = jobs.find((entry) => String(entry.id) === String(card.dataset.id));
      const createdAt = job?.created_at ? new Date(job.created_at) : null;

      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        const sameDay = createdAt.toDateString() === now.toDateString();
        matchesDate = selectedDate === "today" ? sameDay : !sameDay;
      }
    }

    const show = matchesQuery && matchesStatus && matchesTechnician && matchesDate;
    card.classList.toggle("hidden", !show);
    if (show) {
      visible += 1;
    }
  });

  if (visibleCount) {
    visibleCount.textContent = `${visible} active jobs visible`;
  }
}

async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (!query) {
    return null;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (!Array.isArray(data) || !data.length) {
    return null;
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    label: query,
  };
}

function initMap() {
  const mapNode = document.querySelector("#map");
  if (!mapNode || typeof L === "undefined") {
    return;
  }

  map = L.map(mapNode, {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView(defaultMapView.center, defaultMapView.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

function setMapInteraction(enabled) {
  const guard = document.getElementById("mapGuard");
  const toggle = document.getElementById("mapInteractionToggle");

  mapInteractionEnabled = enabled;

  if (map) {
    if (enabled) {
      map.scrollWheelZoom.enable();
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
    } else {
      map.scrollWheelZoom.disable();
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
    }
  }

  if (guard) {
    guard.classList.toggle("hidden", enabled);
  }

  if (toggle) {
    toggle.textContent = enabled ? "Vergrendel kaart" : "Activeer kaart";
    toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
  }
}

async function focusAddress(address) {
  if (!map || !address) {
    return;
  }

  const result = await geocodeAddress(address);
  if (!result) {
    return;
  }

  setMapInteraction(true);
  map.setView([result.lat, result.lon], 13);
  if (focusMarker) {
    focusMarker.remove();
  }
  focusMarker = L.marker([result.lat, result.lon]).addTo(map);
  focusMarker.bindPopup(result.label).openPopup();
}

function resetMapView() {
  if (!map) {
    return;
  }

  map.setView(defaultMapView.center, defaultMapView.zoom);
  if (focusMarker) {
    focusMarker.remove();
    focusMarker = null;
  }
  setMapInteraction(false);
}

function bindSearch() {
  const localSearch = document.querySelector("#job-search");
  const globalSearch = document.querySelector("#global-search");
  const statusFilter = document.querySelector("#status-filter");
  const technicianFilter = document.querySelector("#technician-filter");
  const dateFilter = document.querySelector("#date-filter");

  if (localSearch) {
    localSearch.addEventListener("input", () => {
      syncSearchInputs(localSearch.value);
      filterJobCards();
    });
  }

  if (globalSearch) {
    globalSearch.addEventListener("input", () => {
      syncSearchInputs(globalSearch.value);
      filterJobCards();
    });
  }

  [statusFilter, technicianFilter, dateFilter].forEach((node) => {
    if (node) {
      node.addEventListener("change", filterJobCards);
    }
  });
}

function bindMapControls() {
  const guard = document.getElementById("mapGuard");
  const toggle = document.getElementById("mapInteractionToggle");
  const reset = document.getElementById("mapResetButton");

  if (guard) {
    guard.addEventListener("click", () => {
      setMapInteraction(true);
    });
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      setMapInteraction(!mapInteractionEnabled);
    });
  }

  if (reset) {
    reset.addEventListener("click", () => {
      resetMapView();
    });
  }
}

document.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-address-focus]");
  if (focusButton) {
    focusAddress(focusButton.dataset.addressFocus);
    return;
  }

  const jobTarget = event.target.closest("[data-job-id]");
  if (jobTarget && typeof window.loadJobDetail === "function") {
    window.loadJobDetail(jobTarget.dataset.jobId);
  }
});

initMap();
setMapInteraction(false);
setupSidebarToggle();
bindSearch();
bindMapControls();
filterJobCards();
window.focusAddress = focusAddress;
