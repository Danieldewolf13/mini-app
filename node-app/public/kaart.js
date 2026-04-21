/**
 * kaart.js — volledige kaartpagina
 * Toont live technicierslocaties + actieve job-pins op een Leaflet-kaart.
 */

(function () {
  const jobs = (window.MINI_APP_DATA && window.MINI_APP_DATA.jobs) || [];
  const defaultView = { center: [50.85, 4.35], zoom: 8 };

  let kaartMap = null;
  const techMarkers = {};   // tg_id → marker
  const jobMarkers = {};    // job.id → marker
  const geocodeCache = {};  // address → {lat, lon}

  // ── Kleuren per status ─────────────────────────────────────────────────────

  function statusColor(status) {
    if (!status) return "#888";
    const s = status.toLowerCase();
    if (["new", "urgent", "waiting_technician"].includes(s)) return "#e74c3c";
    if (["in_progress", "on_site"].includes(s)) return "#2980b9";
    if (["waiting_dispatcher", "waiting_parts", "stalled"].includes(s)) return "#f39c12";
    return "#888";
  }

  // ── Marker iconen ──────────────────────────────────────────────────────────

  function techIcon(name) {
    const initials = (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    return L.divIcon({
      className: "",
      html: `<div class="tech-map-marker" title="${escHtml(name)}">${initials}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }

  function jobIcon(status) {
    const color = statusColor(status);
    return L.divIcon({
      className: "",
      html: `<div class="job-map-marker" style="background:${color}" title="${escHtml(status || "")}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function escHtml(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Geocoding via Nominatim (1 req/s max) ─────────────────────────────────

  let _geocodeQueue = [];
  let _geocodeRunning = false;

  function geocode(address) {
    return new Promise((resolve) => {
      if (geocodeCache[address] !== undefined) {
        resolve(geocodeCache[address]);
        return;
      }
      _geocodeQueue.push({ address, resolve });
      if (!_geocodeRunning) processGeocodeQueue();
    });
  }

  async function processGeocodeQueue() {
    _geocodeRunning = true;
    while (_geocodeQueue.length) {
      const { address, resolve } = _geocodeQueue.shift();
      if (geocodeCache[address] !== undefined) {
        resolve(geocodeCache[address]);
        continue;
      }
      try {
        const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(address);
        const resp = await fetch(url, { headers: { "Accept-Language": "nl" } });
        const data = await resp.json();
        const result = data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
        geocodeCache[address] = result;
        resolve(result);
      } catch (_) {
        geocodeCache[address] = null;
        resolve(null);
      }
      // Wacht 1.1s tussen Nominatim-verzoeken (usage policy)
      await new Promise((r) => setTimeout(r, 1100));
    }
    _geocodeRunning = false;
  }

  // ── Job-markers plaatsen ───────────────────────────────────────────────────

  async function placeJobMarkers() {
    for (const job of jobs) {
      if (!job.address) continue;
      const pos = await geocode(job.address);
      if (!pos || !kaartMap) continue;

      const popup = [
        `<strong>#${job.id} — ${escHtml(job.client || "—")}</strong>`,
        `<span>${escHtml(job.address)}</span>`,
        job.technician ? `<span>Technieker: ${escHtml(job.technician)}</span>` : "",
        job.phone ? `<span>Tel: ${escHtml(job.phone)}</span>` : "",
        job.category ? `<span>Type: ${escHtml(job.category)}</span>` : "",
        `<a href="/dispatcher/jobs?id=${job.id}" style="font-size:12px">Bekijk job →</a>`,
      ].filter(Boolean).join("<br>");

      if (jobMarkers[job.id]) {
        jobMarkers[job.id].setLatLng([pos.lat, pos.lon]);
        jobMarkers[job.id].setPopupContent(popup);
      } else {
        jobMarkers[job.id] = L.marker([pos.lat, pos.lon], { icon: jobIcon(job.status), zIndexOffset: 0 })
          .addTo(kaartMap)
          .bindPopup(popup);
      }
    }
  }

  // ── Techniekerlocaties ophalen en bijwerken ────────────────────────────────

  async function refreshTechLocations() {
    if (!kaartMap) return;
    try {
      const resp = await fetch("/api/locations", { credentials: "same-origin" });
      if (!resp.ok) return;
      const locs = await resp.json();

      const activeIds = new Set(locs.map((l) => String(l.tg_id)));
      for (const [id, marker] of Object.entries(techMarkers)) {
        if (!activeIds.has(id)) { marker.remove(); delete techMarkers[id]; }
      }

      locs.forEach((loc) => {
        if (!loc.lat || !loc.lon) return;
        const id = String(loc.tg_id);
        const latLng = [parseFloat(loc.lat), parseFloat(loc.lon)];
        const updatedAt = loc.updated_at ? new Date(loc.updated_at).toLocaleTimeString("nl-BE") : "?";
        const popupText = `<strong>${escHtml(loc.full_name || loc.tech_key || id)}</strong><br>Bijgewerkt: ${updatedAt}`;

        if (techMarkers[id]) {
          techMarkers[id].setLatLng(latLng);
          techMarkers[id].setPopupContent(popupText);
        } else {
          techMarkers[id] = L.marker(latLng, { icon: techIcon(loc.full_name || loc.tech_key || id), zIndexOffset: 1000 })
            .addTo(kaartMap)
            .bindPopup(popupText);
        }
      });

      const label = document.getElementById("kaartRefreshLabel");
      if (label) {
        const now = new Date().toLocaleTimeString("nl-BE");
        label.textContent = `${locs.length} technieker${locs.length !== 1 ? "s" : ""} actief · bijgewerkt ${now}`;
      }
    } catch (_) {}
  }

  // ── Kaart initialiseren ────────────────────────────────────────────────────

  function initKaart() {
    const node = document.getElementById("kaartMap");
    if (!node || typeof L === "undefined") return;

    kaartMap = L.map(node, {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView(defaultView.center, defaultView.zoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(kaartMap);

    // Kaart moet opnieuw renderen na layout settle
    setTimeout(() => { if (kaartMap) kaartMap.invalidateSize(); }, 200);

    // Techniekers ophalen en elke 30s refreshen
    refreshTechLocations();
    setInterval(refreshTechLocations, 30000);

    // Job-pins geocoden (is async + rate-limited)
    placeJobMarkers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKaart);
  } else {
    initKaart();
  }
})();
