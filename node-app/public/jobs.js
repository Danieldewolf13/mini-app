let currentJobId = null;
let currentJobData = null;

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
    <div><strong>Technieker</strong><span>${escapeHtml(data.technician)}</span></div>
    <div><strong>Telefoon</strong><span>${escapeHtml(data.phone)}</span></div>
    <div><strong>Adres</strong><span>${escapeHtml(data.address)}</span></div>
    <div><strong>Categorie</strong><span>${escapeHtml(data.category)}</span></div>
    <div><strong>Probleem</strong><span>${escapeHtml(data.problem)}</span></div>
    <div><strong>Aangemaakt</strong><span>${escapeHtml(data.created_at)}</span></div>
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
    ? `<div><strong>Volgende afspraak</strong><span>${escapeHtml(data.next_appointment.scheduled_at)} - ${escapeHtml(
        data.next_appointment.type
      )}</span></div>`
    : `<div><strong>Volgende afspraak</strong><span>Geen afspraak gepland</span></div>`;

  return data.finance_locked
    ? `
      <p class="muted">Geen toegang tot finance voor deze rol.</p>
      ${appointmentHtml}
    `
    : `
      <div><strong>Status</strong><span>${escapeHtml(data.finance.status)}</span></div>
      <div><strong>Betaalmethode</strong><span>${escapeHtml(data.finance.method)}</span></div>
      <div><strong>Factuur</strong><span>${escapeHtml(data.finance.invoice)}</span></div>
      <div><strong>Bedrag</strong><span>${escapeHtml(data.finance.amount_excl_vat)}</span></div>
      <div><strong>Ontvanger</strong><span>${escapeHtml(data.finance.receiver)}</span></div>
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

  const appointmentTypeOptions = (data.actions?.appointment?.type_options || [])
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${
          option.value === data.actions?.appointment?.type_value ? "selected" : ""
        }>${escapeHtml(option.label)}</option>`
    )
    .join("");

  const appointmentStatusOptions = (data.actions?.appointment?.status_options || [])
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${
          option.value === data.actions?.appointment?.status_value ? "selected" : ""
        }>${escapeHtml(option.label)}</option>`
    )
    .join("");

  const assignSection = data.actions?.assign_label
    ? `
      <label>
        <span>${escapeHtml(data.actions.assign_label)}</span>
        <select id="assignTechnicianSelect" name="technician_id">${assignmentOptions}</select>
      </label>
    `
    : "";

  const appointmentSection = data.actions?.appointment
    ? `
      <label>
        <span>${escapeHtml(data.actions.appointment.label)}</span>
        <input
          id="appointmentDateInput"
          name="scheduled_at"
          type="datetime-local"
          value="${escapeHtml(data.actions.appointment.scheduled_at_value || "")}"
        />
      </label>
      <label>
        <span>Type</span>
        <select id="appointmentTypeSelect" name="afspraak_type">${appointmentTypeOptions}</select>
      </label>
      <label>
        <span>Status</span>
        <select id="appointmentStatusSelect" name="status">${appointmentStatusOptions}</select>
      </label>
    `
    : "";

  return `
    <div id="jobActionFeedback" class="muted"></div>
    <form id="jobActionForm" class="detail-inline-form detail-inline-form--stacked">
      <label>
        <span>${escapeHtml(data.actions?.status_label || "Status wijzigen")}</span>
        <select id="statusSelect" name="status">${statusOptions}</select>
      </label>
      ${assignSection}
      ${appointmentSection}
      <div class="detail-actions-footer">
        <button type="submit" id="jobActionSubmit" class="inline-button">Opslaan</button>
      </div>
    </form>
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

function refreshAfterJobUpdate(updated) {
  if (typeof window.afterJobActionUpdate === "function") {
    return window.afterJobActionUpdate(updated);
  }

  window.setTimeout(() => window.location.reload(), 500);
  return Promise.resolve();
}
function bindJobActionForms() {
  const feedback = document.getElementById("jobActionFeedback");
  const jobActionForm = document.getElementById("jobActionForm");

  if (!jobActionForm) {
    return;
  }

  jobActionForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const statusSelect = document.getElementById("statusSelect");
    const assignSelect = document.getElementById("assignTechnicianSelect");
    const dateInput = document.getElementById("appointmentDateInput");
    const appointmentTypeSelect = document.getElementById("appointmentTypeSelect");
    const appointmentStatusSelect = document.getElementById("appointmentStatusSelect");
    const submit = document.getElementById("jobActionSubmit");

    if (!currentJobId || !statusSelect) {
      return;
    }

    const updates = [];
    const originalStatus = currentJobData?.actions?.status_value ?? null;
    const nextStatus = statusSelect.value;
    if (nextStatus !== originalStatus) {
      updates.push({
        label: "Status",
        pending: "Status wordt opgeslagen...",
        success: "Status bijgewerkt.",
        run: () => applyJobAction(`/api/jobs/${currentJobId}/status`, { status: nextStatus }),
      });
    }

    if (assignSelect) {
      const originalTechnician = String(currentJobData?.actions?.technician_value ?? "");
      const nextTechnician = String(assignSelect.value ?? "");
      if (nextTechnician !== originalTechnician) {
        updates.push({
          label: "Technieker",
          pending: "Toewijzing wordt opgeslagen...",
          success: "Technieker bijgewerkt.",
          run: () => applyJobAction(`/api/jobs/${currentJobId}/assign`, { technician_id: nextTechnician }),
        });
      }
    }

    if (dateInput && appointmentTypeSelect && appointmentStatusSelect) {
      const originalAppointment = currentJobData?.actions?.appointment || {};
      const nextAppointment = {
        scheduled_at: dateInput.value || "",
        afspraak_type: appointmentTypeSelect.value,
        status: appointmentStatusSelect.value,
      };
      const hadAppointment = Boolean(originalAppointment.scheduled_at_value);
      const appointmentChanged =
        nextAppointment.scheduled_at !== String(originalAppointment.scheduled_at_value || "") ||
        nextAppointment.afspraak_type !== String(originalAppointment.type_value || "") ||
        nextAppointment.status !== String(originalAppointment.status_value || "");
      const shouldSaveAppointment = appointmentChanged && (Boolean(nextAppointment.scheduled_at) || hadAppointment);

      if (shouldSaveAppointment) {
        updates.push({
          label: "Afspraak",
          pending: "Afspraak wordt opgeslagen...",
          success: "Afspraak bijgewerkt.",
          run: () => applyJobAction(`/api/jobs/${currentJobId}/appointment`, nextAppointment),
        });
      }
    }

    if (!updates.length) {
      if (feedback) {
        feedback.textContent = "Geen wijzigingen om op te slaan.";
      }
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Bezig...";
    }

    try {
      let updated = null;
      for (const update of updates) {
        if (feedback) {
          feedback.textContent = update.pending;
        }
        updated = await update.run();
      }
      if (feedback) {
        feedback.textContent = updates.length === 1 ? updates[0].success : "Wijzigingen opgeslagen.";
      }
      if (updated) {
        renderJobDetail(updated);
        refreshAfterJobUpdate(updated);
      }
    } catch (error) {
      if (feedback) {
        feedback.textContent = error.message || "Wijzigingen konden niet worden opgeslagen.";
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Opslaan";
      }
    }
  });
}

function renderJobDetail(data) {
  const panel = document.getElementById("jobDetail");
  if (!panel) {
    return;
  }

  currentJobId = data.id;
  currentJobData = data;
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
  if (typeof window.afterJobDetailLoad === "function") {
    window.afterJobDetailLoad(data);
  }
}

window.loadJobDetail = loadJobDetail;

// -- Nieuwe job modaal ------------------------------------------------------
(function () {
  function openModal() {
    const modal = document.getElementById("newJobModal");
    if (modal) {
      modal.classList.remove("hidden");
      document.getElementById("njAddress")?.focus();
    }
  }

  function closeModal() {
    const modal = document.getElementById("newJobModal");
    if (modal) modal.classList.add("hidden");
    const form = document.getElementById("newJobForm");
    if (form) form.reset();
    const fb = document.getElementById("newJobFeedback");
    if (fb) { fb.textContent = ""; fb.className = "form-feedback"; }
  }

  document.addEventListener("click", (e) => {
    if (e.target.id === "openNewJobModal") openModal();
    if (e.target.id === "closeNewJobModal" || e.target.id === "cancelNewJob") closeModal();
    if (e.target.id === "newJobModal") closeModal(); // click backdrop
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "newJobForm") return;
    e.preventDefault();

    const form = e.target;
    const submit = document.getElementById("newJobSubmit");
    const fb = document.getElementById("newJobFeedback");

    submit.disabled = true;
    submit.textContent = "Bezig...";
    if (fb) { fb.textContent = ""; fb.className = "form-feedback"; }

    const body = Object.fromEntries(new FormData(form).entries());

    try {
      const resp = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        if (fb) { fb.textContent = data.error || "Aanmaken mislukt"; fb.className = "form-feedback form-feedback--error"; }
        return;
      }

      closeModal();
      // Reload job list after short delay
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      if (fb) { fb.textContent = err.message || "Verbindingsfout"; fb.className = "form-feedback form-feedback--error"; }
    } finally {
      submit.disabled = false;
      submit.textContent = "Job aanmaken";
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
})();

