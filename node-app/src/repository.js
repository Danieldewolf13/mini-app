const { query } = require("./db");
const {
  classifyGroup,
  formatAfspraakType,
  formatDateTime,
  formatGeneratedAt,
  formatPaymentMethod,
  formatPaymentStatus,
  formatStatus,
  isInternalReceiver,
} = require("./shared");

const ACTIVE_JOB_SELECT = `
  SELECT
    c.id,
    c.category,
    c.problem_type,
    c.work_type,
    c.address_raw,
    c.status,
    c.payment_status,
    c.group_chat_id,
    c.created_at,
    cl.client_name,
    cl.phone,
    u.full_name AS technician_name,
    u.tech_key,
    p.payment_method,
    p.payment_method_code,
    p.payment_type,
    p.invoice_number,
    p.amount_excl_vat,
    p.receiver_scope,
    p.created_by AS payment_created_by
  FROM cards c
  LEFT JOIN clients cl ON c.client_id = cl.id
  LEFT JOIN users u ON c.assigned_to = u.tg_id
  LEFT JOIN (
    SELECT p1.*
    FROM payments p1
    INNER JOIN (
      SELECT card_id, MAX(created_at) AS max_created_at
      FROM payments
      GROUP BY card_id
    ) latest
      ON latest.card_id = p1.card_id
     AND latest.max_created_at = p1.created_at
  ) p ON p.card_id = c.id
`;

async function fetchActiveJobs() {
  const sql = `
    ${ACTIVE_JOB_SELECT}
    WHERE c.status NOT IN ('completed', 'cancelled')
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 250
  `;

  return query(sql);
}

async function fetchJobById(id) {
  const sql = `
    ${ACTIVE_JOB_SELECT}
    WHERE c.id = ${Number(id)}
    LIMIT 1
  `;

  const rows = await query(sql);
  return rows[0] || null;
}

async function fetchUpcomingAppointments() {
  const sql = `
    SELECT
      c.id,
      c.address_raw,
      cl.client_name,
      u.full_name AS technician_name,
      a.scheduled_at,
      a.afspraak_type
    FROM cards c
    LEFT JOIN clients cl ON c.client_id = cl.id
    LEFT JOIN users u ON c.assigned_to = u.tg_id
    INNER JOIN (
      SELECT a1.*
      FROM afspraak a1
      INNER JOIN (
        SELECT card_id, MAX(created_at) AS max_created_at
        FROM afspraak
        WHERE status = 'scheduled'
        GROUP BY card_id
      ) latest
        ON latest.card_id = a1.card_id
       AND latest.max_created_at = a1.created_at
      WHERE a1.status = 'scheduled'
    ) a ON a.card_id = c.id
    WHERE a.scheduled_at >= CURDATE()
      AND a.scheduled_at < DATE_ADD(CURDATE(), INTERVAL 2 DAY)
      AND c.status NOT IN ('completed', 'cancelled', 'done')
    ORDER BY a.scheduled_at ASC
    LIMIT 100
  `;

  return query(sql);
}

async function fetchAppointmentsByJobId(id) {
  const sql = `
    SELECT
      scheduled_at,
      afspraak_type,
      status,
      created_at
    FROM afspraak
    WHERE card_id = ${Number(id)}
    ORDER BY created_at DESC
  `;

  return query(sql);
}

async function fetchTechnicianSummary() {
  const sql = `
    SELECT
      u.tg_id,
      u.full_name,
      u.tech_key,
      u.role,
      COUNT(c.id) AS active_jobs
    FROM users u
    LEFT JOIN cards c
      ON c.assigned_to = u.tg_id
     AND c.status NOT IN ('completed', 'cancelled')
    WHERE u.is_active = 1
    GROUP BY u.tg_id, u.full_name, u.tech_key, u.role
    ORDER BY u.full_name ASC
  `;

  return query(sql);
}

function formatAmount(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return String(value);
  }

  return `EUR ${parsed.toFixed(2)}`;
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

function normalizeJob(job) {
  const status = String(job.status || "unknown").trim();
  const category = String(job.category || "Onbekend").trim();
  const [groupType, groupLabel] = classifyGroup(job.group_chat_id);

  job.group_type = groupType;
  job.group_label = groupLabel;
  job.created_at_label = formatDateTime(job.created_at);
  job.detail_text = String(job.problem_type || job.work_type || "").trim();
  job.status_label = formatStatus(job.status);
  job.payment_status_label = formatPaymentStatus(job.payment_status);
  job.payment_method_label = formatPaymentMethod(job.payment_method_code || job.payment_method);
  job.payment_receiver_kind = isInternalReceiver(job.payment_created_by) ? "intern" : "partner";
  job.amount_excl_vat_label = formatAmount(job.amount_excl_vat);
  job.client = job.client_name || "-";
  job.city = extractCity(job.address_raw);
  job.technician = job.technician_name || null;
  job.status = status;
  job.category = category;

  return job;
}

function buildKpis({ jobs, technicians, appointments, queue }) {
  const urgent = jobs.filter((job) => {
    const status = String(job.status || "").toLowerCase();
    const category = String(job.category || "").toLowerCase();
    return category.includes("dring") || status === "on_the_way";
  }).length;

  const freeTech = technicians.filter((tech) => Number(tech.active_jobs || 0) === 0).length;

  return {
    requires_action: queue.unassigned.length + queue.overdue.length,
    urgent,
    free_tech: freeTech,
    upcoming: appointments.length,
  };
}

function buildQueue(jobs) {
  const now = Date.now();

  const unassigned = jobs
    .filter((job) => !job.technician_name)
    .slice(0, 6)
    .map((job) => ({
      id: job.id,
      city: job.city || "-",
      client: job.client,
      status: job.status_label,
    }));

  const overdue = jobs
    .filter((job) => {
      const createdAt = new Date(job.created_at).getTime();
      if (Number.isNaN(createdAt)) {
        return false;
      }

      const isWaiting = ["new", "waiting_dispatcher", "assigned"].includes(job.status);
      const olderThanFourHours = now - createdAt > 4 * 60 * 60 * 1000;
      return isWaiting && olderThanFourHours;
    })
    .slice(0, 6)
    .map((job) => ({
      id: job.id,
      city: job.city || "-",
      client: job.client,
      status: job.status_label,
    }));

  return { unassigned, overdue };
}

async function buildDashboardPayload() {
  const jobs = (await fetchActiveJobs()).map(normalizeJob);
  const appointments = await fetchUpcomingAppointments();
  const technicians = await fetchTechnicianSummary();

  const statusCounts = {};
  const categoryCounts = {};
  let regularJobs = 0;
  let corpJobs = 0;

  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
    categoryCounts[job.category] = (categoryCounts[job.category] || 0) + 1;

    if (job.group_type === "regular") {
      regularJobs += 1;
    } else if (job.group_type === "corp") {
      corpJobs += 1;
    }
  }

  for (const appointment of appointments) {
    appointment.scheduled_at_label = formatDateTime(appointment.scheduled_at);
    appointment.afspraak_type_label = formatAfspraakType(appointment.afspraak_type);
  }

  const queue = buildQueue(jobs);
  const kpis = buildKpis({ jobs, technicians, appointments, queue });

  return {
    kpis,
    queue,
    jobs,
    appointments,
    technicians,
    map: {
      center: { lat: 50.85, lon: 4.35 },
      zoom: 8,
    },
    status_counts: statusCounts,
    category_counts: categoryCounts,
    regular_jobs: regularJobs,
    corp_jobs: corpJobs,
    generated_at: formatGeneratedAt(),
  };
}

async function buildJobsPayload() {
  const jobs = (await fetchActiveJobs()).map(normalizeJob);
  const technicians = await fetchTechnicianSummary();

  return {
    jobs,
    technicians,
    filters: {
      statuses: [...new Set(jobs.map((job) => job.status).filter(Boolean))],
      technicians: technicians.map((tech) => ({
        id: tech.tg_id,
        name: tech.full_name,
      })),
    },
  };
}

async function buildJobDetailPayload(id) {
  const job = await fetchJobById(id);
  if (!job) {
    return null;
  }

  normalizeJob(job);

  const appointments = await fetchAppointmentsByJobId(id);
  const latestAppointment = appointments[0];
  const documents = [];
  const finance = {
    status: job.payment_status_label,
    method: job.payment_method_label,
    invoice: job.invoice_number || "-",
    amount_excl_vat: job.amount_excl_vat_label,
    receiver: job.payment_receiver_kind,
  };

  return {
    id: job.id,
    client: job.client,
    phone: job.phone || "-",
    address: job.address_raw || "-",
    city: job.city || "-",
    category: job.category,
    status: job.status,
    status_label: job.status_label,
    technician: job.technician || "Niet toegewezen",
    created_at: job.created_at_label,
    problem: job.problem_type || "-",
    work_type: job.work_type || "-",
    group: job.group_label,
    next_appointment: latestAppointment
      ? {
          scheduled_at: formatDateTime(latestAppointment.scheduled_at),
          type: formatAfspraakType(latestAppointment.afspraak_type),
          status: latestAppointment.status || "-",
        }
      : null,
    documents,
    finance,
  };
}

module.exports = {
  buildDashboardPayload,
  buildJobsPayload,
  buildJobDetailPayload,
};
