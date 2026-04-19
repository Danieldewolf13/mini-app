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
    c.assigned_to,
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
      c.assigned_to AS technician_id,
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

function buildUpcomingPreview(appointments) {
  const now = new Date();
  const nextWindow = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const withinFourHours = appointments.filter((appointment) => {
    const scheduledAt = new Date(appointment.scheduled_at);
    const time = scheduledAt.getTime();
    return !Number.isNaN(time) && time >= now.getTime() && time <= nextWindow.getTime();
  });

  if (withinFourHours.length) {
    return withinFourHours.slice(0, 4);
  }

  return appointments.slice(0, 4);
}

async function fetchAppointmentsByJobId(id) {
  const sql = `
    SELECT
      id,
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

async function updateJobStatus(jobId, status) {
  await query(
    `
      UPDATE cards
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      LIMIT 1
    `,
    [String(status || "").trim(), Number(jobId)]
  );
}

async function assignJobTechnician(jobId, technicianId) {
  await query(
    `
      UPDATE cards
      SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      LIMIT 1
    `,
    [technicianId ? Number(technicianId) : null, Number(jobId)]
  );
}

async function updateJobAppointment(jobId, { scheduledAt, afspraakType, status }) {
  const appointments = await fetchAppointmentsByJobId(jobId);
  const latestAppointment = appointments[0] || null;

  if (latestAppointment?.id) {
    await query(
      `
        UPDATE afspraak
        SET scheduled_at = ?, afspraak_type = ?, status = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
        LIMIT 1
      `,
      [scheduledAt, afspraakType, status, Number(latestAppointment.id)]
    );
    return;
  }

  await query(
    `
      INSERT INTO afspraak (card_id, scheduled_at, afspraak_type, status, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [Number(jobId), scheduledAt, afspraakType, status]
  );
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
      AND u.tg_id IS NOT NULL
    GROUP BY u.tg_id, u.full_name, u.tech_key, u.role
    ORDER BY u.full_name ASC
  `;

  return query(sql);
}

async function fetchPlanningTechnicians() {
  const sql = `
    SELECT
      u.tg_id,
      u.full_name,
      u.tech_key,
      u.role
    FROM users u
    WHERE u.is_active = 1
      AND u.tg_id IS NOT NULL
    ORDER BY u.full_name ASC
  `;

  return query(sql);
}

async function fetchUserByTechKey(techKey) {
  const sql = `
    SELECT
      u.tg_id,
      u.full_name,
      u.tech_key,
      u.role,
      u.is_active
    FROM users u
    WHERE u.is_active = 1
      AND LOWER(u.tech_key) = LOWER(?)
    LIMIT 1
  `;

  const rows = await query(sql, [String(techKey || "").trim()]);
  return rows[0] || null;
}

async function fetchUserById(tgId) {
  const sql = `
    SELECT
      u.tg_id,
      u.full_name,
      u.tech_key,
      u.role,
      u.is_active
    FROM users u
    WHERE u.is_active = 1
      AND u.tg_id = ?
    LIMIT 1
  `;

  const rows = await query(sql, [Number(tgId)]);
  return rows[0] || null;
}

async function fetchPlanningJobs(startDate, endDate) {
  const sql = `
    SELECT
      c.id AS job_id,
      c.category,
      c.problem_type,
      c.work_type,
      c.address_raw,
      c.status,
      c.created_at,
      cl.client_name,
      u.tg_id AS technician_id,
      u.full_name AS technician_name,
      u.role AS technician_status,
      a.scheduled_at AS scheduled_start,
      DATE_ADD(a.scheduled_at, INTERVAL 60 MINUTE) AS scheduled_end
    FROM afspraak a
    INNER JOIN cards c ON c.id = a.card_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    LEFT JOIN users u ON u.tg_id = c.assigned_to
    WHERE a.status = 'scheduled'
      AND a.scheduled_at >= '${startDate} 00:00:00'
      AND a.scheduled_at < DATE_ADD('${endDate} 00:00:00', INTERVAL 1 DAY)
      AND c.status NOT IN ('completed', 'cancelled')
    ORDER BY a.scheduled_at ASC, c.id ASC
  `;

  return query(sql);
}


const FORCE_CONFIRM_INTENTS = new Set([
  "submit_invoice_data",
  "register_quick_payment",
  "payment_proof_received",
  "material_request",
  "material_update",
  "quote_request",
  "quote_update",
  "document_request",
  "signed_document_received",
  "reassign_job_request",
  "cancel_job_request",
]);

// Job creation intents — Karen assumes these are always correct (no confirmation)
const JOB_CREATE_INTENTS = new Set(["create_urgent_job", "create_scheduled_job"]);

const SAFE_AUTO_APPLY_INTENTS = new Set([
  "create_urgent_job",
  "create_scheduled_job",
  "update_status",
  "stalled_job_flag",
]);

async function findJobByChatId(chatId) {
  if (!chatId) return null;
  const rows = await query(
    `SELECT id, status FROM cards WHERE group_chat_id = ? AND status NOT IN ('completed', 'cancelled') ORDER BY created_at DESC LIMIT 1`,
    [String(chatId)]
  );
  return rows[0] || null;
}

async function createQuickJob({ address, clientName, phone, category, problemType, createdBy, groupChatId }) {
  const safePhone = (phone || "-").trim() || "-";
  const safeName = (clientName || "...").trim() || "...";
  const safeCategory = (category || "Dringend").trim();
  const safeProblem = (problemType || "Onbekend").trim();
  const safeAddress = (address || "").trim();

  await query(
    `INSERT INTO clients (phone, client_name, client_type) VALUES (?, ?, 'private')`,
    [safePhone, safeName]
  );
  const [{ "LAST_INSERT_ID()": clientId }] = await query(`SELECT LAST_INSERT_ID()`);

  await query(
    `INSERT INTO cards (client_id, category, problem_type, address_raw, status, created_by, group_chat_id)
     VALUES (?, ?, ?, ?, 'new', ?, ?)`,
    [clientId, safeCategory, safeProblem, safeAddress, createdBy || 0, groupChatId || null]
  );
  const [{ "LAST_INSERT_ID()": cardId }] = await query(`SELECT LAST_INSERT_ID()`);
  return Number(cardId);
}

// Takes only the suggested_action id — fetches everything it needs from DB
async function autoApplySuggestedAction(id) {
  const rows = await query(
    `SELECT id, intent, linked_job_id, source_chat_id, source_user_id, parsed_fields_json, proposed_updates_json
     FROM suggested_actions WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  const action = rows[0];
  if (!action) return false;

  const intent = action.intent;
  if (!SAFE_AUTO_APPLY_INTENTS.has(intent)) return false;

  const parsedFields = safeParseJson(action.parsed_fields_json);
  const proposedUpdates = safeParseJson(action.proposed_updates_json);
  const linkedJobId = action.linked_job_id ? Number(action.linked_job_id) : null;

  if (JOB_CREATE_INTENTS.has(intent)) {
    const address = (parsedFields.address || "").trim();
    if (!address) return false; // can't create a job without an address

    const cardId = await createQuickJob({
      address,
      clientName: parsedFields.customer_name,
      phone: parsedFields.phone,
      category: intent === "create_scheduled_job" ? "Afspraak" : "Dringend",
      problemType: parsedFields.problem_type,
      createdBy: action.source_user_id,
      groupChatId: action.source_chat_id,
    });

    await query(
      `UPDATE suggested_actions
       SET status = 'applied', linked_job_id = ?, linked_card_id = ?, link_status = 'exact',
           reviewed_by = 'karen-auto', applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? LIMIT 1`,
      [cardId, cardId, Number(id)]
    );
    return cardId;
  }

  if (!linkedJobId) return false;

  if (intent === "stalled_job_flag") {
    await updateJobStatus(linkedJobId, "waiting_dispatcher");
  } else if (intent === "update_status") {
    const newStatus = proposedUpdates?.job_status;
    if (newStatus) await updateJobStatus(linkedJobId, newStatus);
  }

  await query(
    `UPDATE suggested_actions SET status = 'applied', reviewed_by = 'karen-auto',
     applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? LIMIT 1`,
    [Number(id)]
  );
  return true;
}

async function ensureSuggestedActionsSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS suggested_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_type VARCHAR(50) NOT NULL,
      source_chat_id BIGINT NULL,
      source_message_id BIGINT NULL,
      source_user_id BIGINT NULL,
      intent VARCHAR(100) NOT NULL,
      confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
      linked_job_id BIGINT NULL,
      linked_card_id BIGINT NULL,
      link_status VARCHAR(50) NOT NULL DEFAULT 'unlinked',
      reason_for_confirmation VARCHAR(255) NULL,
      raw_message TEXT NOT NULL,
      parsed_fields_json JSON NOT NULL,
      proposed_updates_json JSON NOT NULL,
      needs_confirmation TINYINT(1) NOT NULL DEFAULT 1,
      status VARCHAR(50) NOT NULL DEFAULT 'new',
      reviewed_by VARCHAR(191) NULL,
      reviewed_at DATETIME NULL,
      applied_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_suggested_actions_source (source_type, source_chat_id, source_message_id),
      KEY idx_suggested_actions_status (status),
      KEY idx_suggested_actions_intent (intent),
      KEY idx_suggested_actions_linked_job (linked_job_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function safeParseJson(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

async function listSuggestedActions(limit = 20) {
  await ensureSuggestedActionsSchema();
  const rows = await query(
    `
      SELECT
        id,
        source_type,
        source_chat_id,
        source_message_id,
        source_user_id,
        intent,
        confidence,
        linked_job_id,
        linked_card_id,
        link_status,
        reason_for_confirmation,
        raw_message,
        parsed_fields_json,
        proposed_updates_json,
        needs_confirmation,
        status,
        reviewed_by,
        reviewed_at,
        applied_at,
        created_at,
        updated_at
      FROM suggested_actions
      WHERE status IN ('new', 'applied')
        AND (status = 'new' OR (status = 'applied' AND reviewed_by = 'karen-auto' AND applied_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)))
        AND (status != 'new' OR linked_job_id IS NOT NULL OR intent IN ('create_urgent_job','create_scheduled_job','submit_invoice_data','register_quick_payment','payment_proof_received','material_request','material_update','quote_request','quote_update','document_request','signed_document_received','reassign_job_request','cancel_job_request'))
      ORDER BY
        CASE status WHEN 'new' THEN 0 ELSE 1 END,
        updated_at DESC, id DESC
      LIMIT ?
    `,
    [Number(limit) || 20]
  );

  return rows.map((row) => ({
    ...row,
    parsed_fields: safeParseJson(row.parsed_fields_json),
    proposed_updates: safeParseJson(row.proposed_updates_json),
  }));
}

async function createOrUpdateSuggestedAction(payload) {
  await ensureSuggestedActionsSchema();

  const sourceType = String(payload.source_type || "telegram").trim() || "telegram";
  const sourceChatId =
    payload.source_chat_id === null || payload.source_chat_id === undefined || payload.source_chat_id === ""
      ? null
      : Number(payload.source_chat_id);
  const sourceMessageId =
    payload.source_message_id === null || payload.source_message_id === undefined || payload.source_message_id === ""
      ? null
      : Number(payload.source_message_id);
  const sourceUserId =
    payload.source_user_id === null || payload.source_user_id === undefined || payload.source_user_id === ""
      ? null
      : Number(payload.source_user_id);
  const confidence = Number(payload.confidence || 0);
  const linkedJobId =
    payload.linked_job_id === null || payload.linked_job_id === undefined || payload.linked_job_id === ""
      ? null
      : Number(payload.linked_job_id);
  const linkedCardId =
    payload.linked_card_id === null || payload.linked_card_id === undefined || payload.linked_card_id === ""
      ? null
      : Number(payload.linked_card_id);
  const parsedFieldsJson = JSON.stringify(payload.parsed_fields || payload.fields || {});
  const proposedUpdatesJson = JSON.stringify(payload.proposed_updates || {});
  const nextStatus = String(payload.status || "new");

  const recentRows = await query(
    `
      SELECT id
      FROM suggested_actions
      WHERE source_type = ?
        AND status = 'new'
        AND ((source_chat_id IS NULL AND ? IS NULL) OR source_chat_id = ?)
        AND ((source_user_id IS NULL AND ? IS NULL) OR source_user_id = ?)
        AND updated_at >= DATE_SUB(NOW(), INTERVAL 20 MINUTE)
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [
      sourceType,
      Number.isFinite(sourceChatId) ? sourceChatId : null,
      Number.isFinite(sourceChatId) ? sourceChatId : null,
      Number.isFinite(sourceUserId) ? sourceUserId : null,
      Number.isFinite(sourceUserId) ? sourceUserId : null,
    ]
  );

  if (recentRows[0]) {
    await query(
      `
        UPDATE suggested_actions
        SET
          source_message_id = ?,
          intent = ?,
          confidence = ?,
          linked_job_id = ?,
          linked_card_id = ?,
          link_status = ?,
          reason_for_confirmation = ?,
          raw_message = ?,
          parsed_fields_json = ?,
          proposed_updates_json = ?,
          needs_confirmation = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        LIMIT 1
      `,
      [
        Number.isFinite(sourceMessageId) ? sourceMessageId : null,
        String(payload.intent || "unknown"),
        Number.isFinite(confidence) ? confidence : 0,
        Number.isFinite(linkedJobId) ? linkedJobId : null,
        Number.isFinite(linkedCardId) ? linkedCardId : null,
        String(payload.link_status || "unlinked"),
        payload.reason_for_confirmation ? String(payload.reason_for_confirmation) : null,
        String(payload.raw_message || ""),
        parsedFieldsJson,
        proposedUpdatesJson,
        payload.needs_confirmation ? 1 : 0,
        nextStatus,
        recentRows[0].id,
      ]
    );
    return recentRows[0];
  }

  await query(
    `
      INSERT INTO suggested_actions (
        source_type,
        source_chat_id,
        source_message_id,
        source_user_id,
        intent,
        confidence,
        linked_job_id,
        linked_card_id,
        link_status,
        reason_for_confirmation,
        raw_message,
        parsed_fields_json,
        proposed_updates_json,
        needs_confirmation,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        source_user_id = VALUES(source_user_id),
        intent = VALUES(intent),
        confidence = VALUES(confidence),
        linked_job_id = VALUES(linked_job_id),
        linked_card_id = VALUES(linked_card_id),
        link_status = VALUES(link_status),
        reason_for_confirmation = VALUES(reason_for_confirmation),
        raw_message = VALUES(raw_message),
        parsed_fields_json = VALUES(parsed_fields_json),
        proposed_updates_json = VALUES(proposed_updates_json),
        needs_confirmation = VALUES(needs_confirmation),
        status = VALUES(status),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      sourceType,
      Number.isFinite(sourceChatId) ? sourceChatId : null,
      Number.isFinite(sourceMessageId) ? sourceMessageId : null,
      Number.isFinite(sourceUserId) ? sourceUserId : null,
      String(payload.intent || "unknown"),
      Number.isFinite(confidence) ? confidence : 0,
      Number.isFinite(linkedJobId) ? linkedJobId : null,
      Number.isFinite(linkedCardId) ? linkedCardId : null,
      String(payload.link_status || "unlinked"),
      payload.reason_for_confirmation ? String(payload.reason_for_confirmation) : null,
      String(payload.raw_message || ""),
      parsedFieldsJson,
      proposedUpdatesJson,
      payload.needs_confirmation ? 1 : 0,
      nextStatus,
    ]
  );

  const rows = await query(
    `
      SELECT id
      FROM suggested_actions
      WHERE source_type = ?
        AND ((source_chat_id IS NULL AND ? IS NULL) OR source_chat_id = ?)
        AND ((source_message_id IS NULL AND ? IS NULL) OR source_message_id = ?)
      LIMIT 1
    `,
    [
      sourceType,
      Number.isFinite(sourceChatId) ? sourceChatId : null,
      Number.isFinite(sourceChatId) ? sourceChatId : null,
      Number.isFinite(sourceMessageId) ? sourceMessageId : null,
      Number.isFinite(sourceMessageId) ? sourceMessageId : null,
    ]
  );

  return rows[0] || null;
}

async function updateSuggestedActionStatus(id, status, reviewedBy) {
  await ensureSuggestedActionsSchema();
  await query(
    `
      UPDATE suggested_actions
      SET
        status = ?,
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      LIMIT 1
    `,
    [String(status || "new"), reviewedBy ? String(reviewedBy) : null, Number(id)]
  );
}


async function fetchSuggestedActionById(id) {
  await ensureSuggestedActionsSchema();
  const rows = await query(
    `
      SELECT
        id,
        intent,
        linked_job_id,
        linked_card_id,
        link_status,
        reason_for_confirmation,
        raw_message,
        parsed_fields_json,
        proposed_updates_json,
        needs_confirmation,
        status
      FROM suggested_actions
      WHERE id = ?
      LIMIT 1
    `,
    [Number(id)]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    ...row,
    parsed_fields: safeParseJson(row.parsed_fields_json),
    proposed_updates: safeParseJson(row.proposed_updates_json),
  };
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

function formatDateTimeFieldValue(value) {
  if (!value) {
    return "";
  }

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return "";
  }

  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const hours = String(dt.getHours()).padStart(2, "0");
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
  job.technician_id = job.assigned_to || null;
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
    requires_action:
      queue.unassigned.length +
      queue.overdue.length +
      queue.waiting_confirmation.length +
      queue.missing_documents.length,
    urgent,
    free_tech: freeTech,
    upcoming: appointments.length,
  };
}

function buildQueue(jobs) {
  const now = Date.now();

  const buckets = {
    unassigned: [],
    overdue: [],
    waiting_confirmation: [],
    missing_documents: [],
  };

  for (const job of jobs) {
    const createdAt = new Date(job.created_at).getTime();
    const isOverdue =
      !Number.isNaN(createdAt) &&
      ["new", "waiting_dispatcher", "assigned"].includes(job.status) &&
      now - createdAt > 4 * 60 * 60 * 1000;
    const isWaitingConfirmation = job.payment_status === "waiting_confirmation";
    const isMissingDocuments =
      !job.invoice_number && ["partial", "paid_full", "waiting_confirmation"].includes(job.payment_status);

    const item = {
      id: job.id,
      client: job.client,
      city: job.city || "-",
      status: job.status_label,
      technician: job.technician || "Unassigned",
      created_at: job.created_at_label,
    };

    if (!job.technician_name) {
      buckets.unassigned.push(item);
    } else if (isOverdue) {
      buckets.overdue.push(item);
    } else if (isWaitingConfirmation) {
      buckets.waiting_confirmation.push(item);
    } else if (isMissingDocuments) {
      buckets.missing_documents.push(item);
    }
  }

  return {
    unassigned: buckets.unassigned.slice(0, 6),
    overdue: buckets.overdue.slice(0, 6),
    waiting_confirmation: buckets.waiting_confirmation.slice(0, 6),
    missing_documents: buckets.missing_documents.slice(0, 6),
  };
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
    appointments_preview: buildUpcomingPreview(appointments),
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
  if (latestAppointment) {
    documents.push({
      name: `Appointment Â· ${formatAfspraakType(latestAppointment.afspraak_type)}`,
      verified: latestAppointment.status || "-",
    });
  }
  if (job.invoice_number) {
    documents.push({
      name: `Invoice Â· ${job.invoice_number}`,
      verified: "linked",
    });
  } else if (["partial", "paid_full", "waiting_confirmation"].includes(job.payment_status)) {
    documents.push({
      name: "Invoice",
      verified: "missing",
    });
  }
  const finance = {
    status: job.payment_status_label,
    method: job.payment_method_label,
    invoice: job.invoice_number || "-",
    amount_excl_vat: job.amount_excl_vat_label,
    receiver: job.payment_receiver_kind,
  };
  const assignmentOptions = (await fetchPlanningTechnicians()).map((technician) => ({
    value: technician.tg_id,
    label: `${technician.full_name} Â· ${technician.tech_key || "-"}`,
  }));
  const statusOptions = [
    { value: "new", label: formatStatus("new") },
    { value: "waiting_dispatcher", label: formatStatus("waiting_dispatcher") },
    { value: "assigned", label: formatStatus("assigned") },
    { value: "on_the_way", label: formatStatus("on_the_way") },
    { value: "in_progress", label: formatStatus("in_progress") },
    { value: "completed", label: formatStatus("completed") },
    { value: "cancelled", label: formatStatus("cancelled") },
  ];
  const appointmentTypeOptions = [
    { value: "material", label: formatAfspraakType("material") },
    { value: "second_visit", label: formatAfspraakType("second_visit") },
    { value: "nazorg", label: formatAfspraakType("nazorg") },
    { value: "other", label: formatAfspraakType("other") },
  ];
  const appointmentStatusOptions = [
    { value: "scheduled", label: "Gepland" },
    { value: "completed", label: "Afgerond" },
    { value: "cancelled", label: "Geannuleerd" },
  ];
  const actions = {
    assign_label: job.technician ? "Reassign technician" : "Assign technician",
    status_label: `Update status Â· ${job.status_label}`,
    status_value: job.status,
    status_options: statusOptions,
    technician_value: job.technician_id,
    assignment_options: assignmentOptions,
    appointment: {
      label: latestAppointment ? "Appointment aanpassen" : "Appointment plannen",
      scheduled_at_value: formatDateTimeFieldValue(latestAppointment?.scheduled_at),
      type_value: latestAppointment?.afspraak_type || "material",
      status_value: latestAppointment?.status || "scheduled",
      type_options: appointmentTypeOptions,
      status_options: appointmentStatusOptions,
    },
  };

  return {
    id: job.id,
    technician_id: job.technician_id,
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
    actions,
  };
}

// ── Live technician locations ──────────────────────────────────────────────

async function ensureLocationSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS technician_locations (
      tg_id        BIGINT       NOT NULL PRIMARY KEY,
      full_name    VARCHAR(120) NULL,
      latitude     DOUBLE       NOT NULL,
      longitude    DOUBLE       NOT NULL,
      accuracy     FLOAT        NULL,
      updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function upsertTechnicianLocation({ tgId, fullName, latitude, longitude, accuracy }) {
  await ensureLocationSchema();
  await query(
    `INSERT INTO technician_locations (tg_id, full_name, latitude, longitude, accuracy, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       full_name  = VALUES(full_name),
       latitude   = VALUES(latitude),
       longitude  = VALUES(longitude),
       accuracy   = VALUES(accuracy),
       updated_at = NOW()`,
    [Number(tgId), fullName || null, Number(latitude), Number(longitude), accuracy ? Number(accuracy) : null]
  );
}

async function fetchActiveTechnicianLocations() {
  await ensureLocationSchema();
  // Only show locations updated in the last 2 hours
  const rows = await query(`
    SELECT tg_id, full_name, latitude, longitude, accuracy, updated_at
    FROM technician_locations
    WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
    ORDER BY updated_at DESC
  `);
  return rows;
}

module.exports = {
  assignJobTechnician,
  autoApplySuggestedAction,
  buildDashboardPayload,
  buildJobsPayload,
  buildJobDetailPayload,
  createOrUpdateSuggestedAction,
  createQuickJob,
  ensureSuggestedActionsSchema,
  fetchActiveTechnicianLocations,
  fetchSuggestedActionById,
  fetchUserById,
  fetchUserByTechKey,
  findJobByChatId,
  FORCE_CONFIRM_INTENTS,
  JOB_CREATE_INTENTS,
  fetchPlanningJobs,
  fetchPlanningTechnicians,
  listSuggestedActions,
  SAFE_AUTO_APPLY_INTENTS,
  updateJobAppointment,
  updateJobStatus,
  updateSuggestedActionStatus,
  upsertTechnicianLocation,
};


