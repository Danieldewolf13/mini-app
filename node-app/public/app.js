const dashboardData = window.MINI_APP_DATA || {};
const jobs = dashboardData.jobs || [];

let map;
let focusMarker;
const defaultMapView = { center: [50.85, 4.35], zoom: 8 };
let mapInteractionEnabled = false;
const jobMarkers = {};

function setupSidebarToggle() {
  const toggles = Array.from(document.querySelectorAll("[data-sidebar-toggle]"));
  const shell = document.querySelector(".app-shell");

  if (!toggles.length || !shell) {
    return;
  }

  const storageKey = "mini-app-sidebar-collapsed";

  function applyState(collapsed) {
    shell.classList.toggle("sidebar-collapsed", collapsed);
    toggles.forEach((toggle) => {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
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

  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const collapsed = !shell.classList.contains("sidebar-collapsed");
      applyState(collapsed);
      try {
        window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
      } catch (error) {
        // ignore storage issues and keep UI functional
      }
    });
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
    visibleCount.textContent = `${visible} zichtbare jobs`;
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

const technicianMarkers = {};

function techIcon(name) {
  const initials = (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return L.divIcon({
    className: "",
    html: `<div class="tech-map-marker" title="${name}">${initials}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function minutesAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (diff < 1) return "nu";
  if (diff === 1) return "1 min geleden";
  return `${diff} min geleden`;
}

function statusColor(status) {
  if (!status) return "#6b7484";
  const s = String(status).toLowerCase();
  if (["new", "urgent", "waiting_technician"].includes(s)) return "#d94841";
  if (["in_progress", "on_site", "on_the_way"].includes(s)) return "#2f6bb2";
  if (["waiting_dispatcher", "waiting_parts", "stalled", "assigned"].includes(s)) return "#d29a1f";
  return "#6b7484";
}

function jobIcon(status) {
  return L.divIcon({
    className: "",
    html: `<div class="job-map-marker" style="background:${statusColor(status)}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

async function placeJobMarkers() {
  if (!map) return;

  for (const job of jobs) {
    const address = String(job.address_raw || job.address || "").trim();
    if (!address) continue;

    const pos = await geocodeAddress(address);
    if (!pos || !map) continue;

    const popup = [
      `<strong>#${escapeHtml(job.id)} - ${escapeHtml(job.client || "Onbekend")}</strong>`,
      `<span>${escapeHtml(address)}</span>`,
      job.technician ? `<span>Technieker: ${escapeHtml(job.technician)}</span>` : "",
      job.phone ? `<span>Tel: ${escapeHtml(job.phone)}</span>` : "",
      job.category ? `<span>Type: ${escapeHtml(job.category)}</span>` : "",
    ].filter(Boolean).join("<br>");

    if (jobMarkers[job.id]) {
      jobMarkers[job.id].setLatLng([pos.lat, pos.lon]);
      jobMarkers[job.id].setPopupContent(popup);
    } else {
      jobMarkers[job.id] = L.marker([pos.lat, pos.lon], { icon: jobIcon(job.status), zIndexOffset: 50 })
        .addTo(map)
        .bindPopup(popup);
    }
  }
}

async function refreshTechnicianLocations() {
  if (!map) return;
  try {
    const resp = await fetch("/api/locations", { credentials: "same-origin" });
    if (!resp.ok) {
      console.warn("[locaties] GET /api/locations →", resp.status);
      return;
    }
    const locs = await resp.json();

    // Remove markers for technicians no longer in response
    const activeIds = new Set(locs.map((l) => String(l.tg_id)));
    for (const [id, marker] of Object.entries(technicianMarkers)) {
      if (!activeIds.has(id)) {
        marker.remove();
        delete technicianMarkers[id];
      }
    }

    // Add or update markers
    locs.forEach((loc) => {
      const id = String(loc.tg_id);
      const latLng = [loc.latitude, loc.longitude];
      const popupText = `<strong>${loc.full_name || "Technieker"}</strong><br>${minutesAgo(loc.updated_at)}`;
      if (technicianMarkers[id]) {
        technicianMarkers[id].setLatLng(latLng);
        technicianMarkers[id].setPopupContent(popupText);
      } else {
        technicianMarkers[id] = L.marker(latLng, { icon: techIcon(loc.full_name), zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(popupText);
      }
    });
  } catch (_e) {
    // network errors are non-fatal
  }
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

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap &copy; CARTO",
  }).addTo(map);

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);

  // Load technician locations immediately and refresh every 30s
  refreshTechnicianLocations();
  setInterval(refreshTechnicianLocations, 30000);
  placeJobMarkers();
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
