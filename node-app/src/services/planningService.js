const { fetchPlanningJobs, fetchPlanningTechnicians } = require("../repository");

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }
  return raw;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function extractCity(address) {
  const raw = String(address || "").trim();
  if (!raw) {
    return "";
  }

  const segments = raw
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const tail = segments[segments.length - 1] || raw;
  const noCountry = /belgium$/i.test(tail) ? segments[segments.length - 2] || tail : tail;
  const cityMatch = String(noCountry).match(/\b\d{4}\s+(.+)$/);

  if (cityMatch?.[1]) {
    return cityMatch[1].trim();
  }

  return String(noCountry).replace(/^\d{4}\s+/, "").trim();
}

function deriveRegionFromAddress(address) {
  const raw = String(address || "");
  const match = raw.match(/\b(\d{4})\b/);
  if (!match) {
    return extractCity(address) || "Onbekend";
  }

  const code = Number(match[1]);
  if (code >= 1000 && code <= 1299) return "Brussels";
  if (code >= 1300 && code <= 1499) return "Walloon Brabant";
  if (code >= 1500 && code <= 1999) return "Vlaams-Brabant";
  if (code >= 2000 && code <= 2999) return "Antwerp";
  if (code >= 3000 && code <= 3499) return "Vlaams-Brabant";
  if (code >= 3500 && code <= 3999) return "Limburg";
  if (code >= 4000 && code <= 4999) return "Liege";
  if (code >= 5000 && code <= 5999) return "Namur";
  if (code >= 6000 && code <= 7999) return "Hainaut";
  if (code >= 8000 && code <= 8999) return "West Flanders";
  if (code >= 9000 && code <= 9999) return "East Flanders";
  return extractCity(address) || "Onbekend";
}

function statusClass(status) {
  const raw = String(status || "").trim();
  return raw || "unassigned";
}

function buildTechnicians(rawTechnicians, jobs) {
  const usage = new Map();

  jobs.forEach((job) => {
    if (!job.technician_id) {
      return;
    }
    usage.set(job.technician_id, (usage.get(job.technician_id) || 0) + 1);
  });

  const technicians = rawTechnicians.map((tech) => {
    const activeCount = usage.get(tech.tg_id) || 0;
    const region = jobs.find((job) => Number(job.technician_id) === Number(tech.tg_id))?.region || "General";

    return {
      id: tech.tg_id,
      name: tech.full_name,
      status: activeCount > 0 ? "busy" : "available",
      region,
      role: tech.role,
      active_jobs: activeCount,
    };
  });

  const hasUnassigned = jobs.some((job) => !job.technician_id);
  if (hasUnassigned) {
    technicians.push({
      id: "unassigned",
      name: "Unassigned",
      status: "attention",
      region: "All",
      role: "queue",
      active_jobs: jobs.filter((job) => !job.technician_id).length,
    });
  }

  return technicians;
}

function buildJobs(rawJobs, date) {
  const now = new Date();

  return rawJobs.map((job) => {
    const start = new Date(job.scheduled_start);
    const end = job.scheduled_end ? new Date(job.scheduled_end) : new Date(start.getTime() + 60 * 60 * 1000);
    const city = extractCity(job.address_raw);
    const region = deriveRegionFromAddress(job.address_raw);
    const technicianId = job.technician_id || null;
    const status = statusClass(job.status);
    const urgent = /dring|urgent/i.test(String(job.category || "")) || status === "on_the_way";
    const overdue = start.getTime() < now.getTime() && !["done", "completed", "cancelled"].includes(status);

    return {
      id: job.job_id,
      client: job.client_name || "-",
      city,
      region,
      start: start.toISOString().slice(0, 19),
      end: end.toISOString().slice(0, 19),
      technician_id: technicianId || "unassigned",
      status,
      urgent,
      overdue,
      address: job.address_raw || "",
      title: job.problem_type || job.work_type || job.category || "Job",
      date,
    };
  });
}

function buildWeekOverview(date, technicians, jobs) {
  const endDate = addDays(date, 6);
  return {
    message: `Week view toont voorlopig een lichte overview van ${date} tot ${endDate}.`,
    totals: technicians.map((tech) => ({
      technician_id: tech.id,
      name: tech.name,
      jobs: jobs.filter((job) => String(job.technician_id) === String(tech.id)).length,
    })),
  };
}

async function getPlanningData(dateInput, viewInput) {
  const date = normalizeDateInput(dateInput);
  const view = viewInput === "week" ? "week" : "day";
  const startDate = date;
  const endDate = view === "week" ? addDays(date, 6) : date;

  const [rawTechnicians, rawJobs] = await Promise.all([
    fetchPlanningTechnicians(),
    fetchPlanningJobs(startDate, endDate),
  ]);

  const jobs = buildJobs(rawJobs, date);
  const technicians = buildTechnicians(rawTechnicians, jobs);

  return {
    date,
    view,
    technicians,
    jobs,
    week: view === "week" ? buildWeekOverview(date, technicians, jobs) : null,
  };
}

module.exports = {
  getPlanningData,
};
