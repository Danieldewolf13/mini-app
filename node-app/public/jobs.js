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

  panel.classList.remove("hidden");
  document.getElementById("jobDetailTitle").textContent = `#${data.id} · ${data.client}`;
  document.getElementById("jobOverview").innerHTML = `
    <div><strong>Status</strong><span>${data.status_label}</span></div>
    <div><strong>Technician</strong><span>${data.technician}</span></div>
    <div><strong>Phone</strong><span>${data.phone}</span></div>
    <div><strong>Address</strong><span>${data.address}</span></div>
    <div><strong>Category</strong><span>${data.category}</span></div>
    <div><strong>Problem</strong><span>${data.problem}</span></div>
    <div><strong>Created</strong><span>${data.created_at}</span></div>
  `;

  document.getElementById("jobDocs").innerHTML = data.documents.length
    ? data.documents
        .map(
          (doc) => `
            <div>
              <strong>${doc.name}</strong>
              <span>${doc.verified}</span>
            </div>
          `
        )
        .join("")
    : `<p class="muted">Nog geen documenten gekoppeld.</p>`;

  const appointmentHtml = data.next_appointment
    ? `<div><strong>Next appointment</strong><span>${data.next_appointment.scheduled_at} · ${data.next_appointment.type}</span></div>`
    : `<div><strong>Next appointment</strong><span>Geen afspraak gepland</span></div>`;

  document.getElementById("jobFinance").innerHTML = data.finance_locked
    ? `
      <p class="muted">Geen toegang tot finance voor deze rol.</p>
      ${appointmentHtml}
    `
    : `
      <div><strong>Status</strong><span>${data.finance.status}</span></div>
      <div><strong>Method</strong><span>${data.finance.method}</span></div>
      <div><strong>Invoice</strong><span>${data.finance.invoice}</span></div>
      <div><strong>Amount</strong><span>${data.finance.amount_excl_vat}</span></div>
      <div><strong>Receiver</strong><span>${data.finance.receiver}</span></div>
      ${appointmentHtml}
    `;

  const assignBtn = document.getElementById("assignBtn");
  const statusBtn = document.getElementById("statusBtn");
  if (assignBtn) {
    if (data.actions?.assign_label) {
      assignBtn.textContent = data.actions.assign_label;
      assignBtn.classList.remove("hidden");
    } else {
      assignBtn.classList.add("hidden");
    }
  }
  if (statusBtn) {
    statusBtn.textContent = data.actions?.status_label || "Change status";
  }
}

window.loadJobDetail = loadJobDetail;
