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

async function fetchActiveJobs() {
  const sql = `
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
    WHERE c.status NOT IN ('completed', 'cancelled')
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 250
  `;

  return query(sql);
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

async function buildDashboardPayload() {
  const jobs = await fetchActiveJobs();
  const appointments = await fetchUpcomingAppointments();
  const technicians = await fetchTechnicianSummary();

  const statusCounts = {};
  const categoryCounts = {};
  let regularJobs = 0;
  let corpJobs = 0;

  for (const job of jobs) {
    const status = String(job.status || "unknown").trim();
    const category = String(job.category || "Onbekend").trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    const [groupType, groupLabel] = classifyGroup(job.group_chat_id);
    job.group_type = groupType;
    job.group_label = groupLabel;

    if (groupType === "regular") {
      regularJobs += 1;
    } else if (groupType === "corp") {
      corpJobs += 1;
    }

    job.created_at_label = formatDateTime(job.created_at);
    job.detail_text = String(job.problem_type || job.work_type || "").trim();
    job.status_label = formatStatus(job.status);
    job.payment_status_label = formatPaymentStatus(job.payment_status);
    job.payment_method_label = formatPaymentMethod(job.payment_method_code || job.payment_method);
    job.payment_receiver_kind = isInternalReceiver(job.payment_created_by) ? "intern" : "partner";
    job.amount_excl_vat_label = formatAmount(job.amount_excl_vat);
  }

  for (const appointment of appointments) {
    appointment.scheduled_at_label = formatDateTime(appointment.scheduled_at);
    appointment.afspraak_type_label = formatAfspraakType(appointment.afspraak_type);
  }

  return {
    jobs,
    appointments,
    technicians,
    status_counts: statusCounts,
    category_counts: categoryCounts,
    regular_jobs: regularJobs,
    corp_jobs: corpJobs,
    generated_at: formatGeneratedAt(),
  };
}

module.exports = {
  buildDashboardPayload,
};
