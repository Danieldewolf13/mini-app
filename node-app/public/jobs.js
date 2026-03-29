let currentJobId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderJobOverview(data) {
  return `
    <div><strong>Status</strong><span>${escapeHtml(data.status_label)}</span></div>
    <div><strong>Technician</strong><span>${escapeHtml(data.technician)}</span></div>
    <div><strong>Phone</strong><span>${escapeHtml(data.phone)}</span></div>
    <div><strong>Address</strong><span>${escapeHtml(data.address)}</span></div>
    <div><strong>Category</strong><span>${escapeHtml(data.category)}</span></div>
    <div><strong>Problem</strong><span>${escapeHtml(data.problem)}</span></div>
    <div><strong>Created</strong><span>${escapeHtml(data.created_at)}</span></div>
  `;
}

function renderJobDocuments(data) {
  return data.documents.length
    ? data.documents
        .map(
          (doc) => `
            <div>
              <strong>${escapeHtml(doc.name)}</strong>
              <span>${escapeHtml(doc.verified)}</span>
            </div>
          `
        )
        .join("")
    : `<p class="muted">Nog geen documenten gekoppeld.</p>`;
}

function renderJobFinance(data) {
  const appointmentHtml = data.next_appointment
    ? `<div><strong>Next appointment</strong><span>${escapeHtml(data.next_appointment.scheduled_at)} - ${escapeHtml(
        data.next_appointment.type
      )}</span></div>`
    : `<div><strong>Next appointment</strong><span>Geen afspraak gepland</span></div>`;

  return data.finance_locked
    ? `
      <p class="muted">Geen toegang tot finance voor deze rol.</p>
      ${appointmentHtml}
    `
    : `
      <div><strong>Status</strong><span>${escapeHtml(data.finance.status)}</span></div>
      <div><strong>Method</strong><span>${escapeHtml(data.finance.method)}</span></div>
      <div><strong>Invoice</strong><span>${escapeHtml(data.finance.invoice)}</span></div>
      <div><strong>Amount</strong><span>${escapeHtml(data.finance.amount_excl_vat)}</span></div>
      <div><strong>Receiver</strong><span>${escapeHtml(data.finance.receiver)}</span></div>
      ${appointmentHtml}
    `;
}

function renderJobActions(data) {
  const statusOptions = (data.actions?.status_options || [])
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${option.value === data.actions?.status_value ? "selected" : ""}>${escapeHtml(
          option.label
        )}</option>`
    )
    .join("");

  const assignmentOptions = [
    `<option value="">Niet toegewezen</option>`,
    ...(data.actions?.assignment_options || []).map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${
          String(option.value) === String(data.actions?.technician_value ?? "") ? "selected" : ""
        }>${escapeHtml(option.label)}</option>`
    ),
  ].join("");

  const assignSection = data.actions?.assign_label
    ? `
      <form id="assignForm" class="detail-inline-form">
        <label>
          <span>${escapeHtml(data.actions.assign_label)}</span>
          <select id="assignTechnicianSelect" name="technician_id">${assignmentOptions}</select>
        </label>
        <button type="submit" class="inline-button">Opslaan</button>
      </form>
    `
    : "";

  return `
    <div id="jobActionFeedback" class="muted"></div>
    <form id="statusForm" class="detail-inline-form">
      <label>
        <span>${escapeHtml(data.actions?.status_label || "Status wijzigen")}</span>
        <select id="statusSelect" name="status">${statusOptions}</select>
      </label>
      <button type="submit" class="inline-button">Opslaan</button>
    </form>
    ${assignSection}
  `;
}

async function applyJobAction(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Actie mislukt");
  }

  return data.job;
}

function bindJobActionForms() {
  const feedback = document.getElementById("jobActionFeedback");
  const statusForm = document.getElementById("statusForm");
  const assignForm = document.getElementById("assignForm");

  if (statusForm) {
    statusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const statusSelect = document.getElementById("statusSelect");
      if (!currentJobId || !statusSelect) {
        return;
      }

      try {
        if (feedback) {
          feedback.textContent = "Status wordt opgeslagen...";
        }
        const updated = await applyJobAction(`/api/jobs/${currentJobId}/status`, {
          status: statusSelect.value,
        });
        if (feedback) {
          feedback.textContent = "Status bijgewerkt.";
        }
        renderJobDetail(updated);
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        if (feedback) {
          feedback.textContent = error.message || "Status kon niet worden opgeslagen.";
        }
      }
    });
  }

  if (assignForm) {
    assignForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const select = document.getElementById("assignTechnicianSelect");
      if (!currentJobId || !select) {
        return;
      }

      try {
        if (feedback) {
          feedback.textContent = "Toewijzing wordt opgeslagen...";
        }
        const updated = await applyJobAction(`/api/jobs/${currentJobId}/assign`, {
          technician_id: select.value,
        });
        if (feedback) {
          feedback.textContent = "Technieker bijgewerkt.";
        }
        renderJobDetail(updated);
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        if (feedback) {
          feedback.textContent = error.message || "Technieker kon niet worden opgeslagen.";
        }
      }
    });
  }
}

function renderJobDetail(data) {
  const panel = document.getElementById("jobDetail");
  if (!panel) {
    return;
  }

  currentJobId = data.id;
  panel.classList.remove("hidden");
  document.getElementById("jobDetailTitle").textContent = `#${data.id} - ${data.client}`;
  document.getElementById("jobOverview").innerHTML = renderJobOverview(data);
  document.getElementById("jobDocs").innerHTML = renderJobDocuments(data);
  document.getElementById("jobFinance").innerHTML = renderJobFinance(data);
  document.getElementById("jobActions").innerHTML = renderJobActions(data);
  bindJobActionForms();
}

async function loadJobDetail(id) {
  const panel = document.getElementById("jobDetail");
  if (!panel) {
    return;
  }

  const response = await fetch(`/api/jobs/${id}`);
  if (!response.ok) {
    return;
  }

  const data = await response.json();
  renderJobDetail(data);
}

window.loadJobDetail = loadJobDetail;
