const jobs = window.MINI_APP_DATA?.jobs || [];

const searchInput = document.querySelector("#job-search");
const statusFilter = document.querySelector("#status-filter");
const categoryFilter = document.querySelector("#category-filter");
const visibleCount = document.querySelector("#visible-count");
const jobCards = Array.from(document.querySelectorAll(".job-card"));

let map;
let focusMarker;

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput?.value);
  const selectedStatus = normalize(statusFilter?.value);
  const selectedCategory = normalize(categoryFilter?.value);

  let visible = 0;

  jobCards.forEach((card) => {
    const matchesQuery = !query || normalize(card.dataset.search).includes(query);
    const matchesStatus = !selectedStatus || normalize(card.dataset.status) === selectedStatus;
    const matchesCategory = !selectedCategory || normalize(card.dataset.category) === selectedCategory;
    const show = matchesQuery && matchesStatus && matchesCategory;
    card.classList.toggle("hidden", !show);
    if (show) visible += 1;
  });

  if (visibleCount) {
    visibleCount.textContent = `${visible} jobs zichtbaar`;
  }
}

async function geocodeAddress(address) {
  const query = String(address || "").trim();
  if (!query) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || !data.length) return null;

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    label: query,
  };
}

function initMap() {
  const mapNode = document.querySelector("#map");
  if (!mapNode || typeof L === "undefined") return;

  map = L.map(mapNode, {
    zoomControl: true,
  }).setView([50.85, 4.35], 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

async function focusAddress(address) {
  if (!map || !address) return;
  const result = await geocodeAddress(address);
  if (!result) return;

  map.setView([result.lat, result.lon], 13);

  if (focusMarker) {
    focusMarker.remove();
  }
  focusMarker = L.marker([result.lat, result.lon]).addTo(map);
  focusMarker.bindPopup(result.label).openPopup();
}

function bindActions() {
  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (statusFilter) statusFilter.addEventListener("change", applyFilters);
  if (categoryFilter) categoryFilter.addEventListener("change", applyFilters);

  document.querySelectorAll("[data-focus-address]").forEach((button) => {
    button.addEventListener("click", () => {
      focusAddress(button.dataset.focusAddress);
    });
  });
}

initMap();
bindActions();
applyFilters();
