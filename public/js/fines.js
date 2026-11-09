async function loadSummary() {
  const { ok, data } = await api('/api/fines/summary');
  if (!ok) return;

  const card = (label, value, color, note = '') => `
    <div class="col-md-4">
      <div class="card shadow-sm border-${color}">
        <div class="card-body text-center">
          <div class="text-muted">${label}</div>
          <div class="display-6 fw-bold text-${color}">Rs. ${value}</div>
          <small class="text-muted">${note}</small>
        </div>
      </div>
    </div>`;

  document.getElementById('summary').innerHTML =
    card('Unpaid fines', data.unpaid_total, data.unpaid_total > 0 ? 'danger' : 'success', 'To collect from students') +
    card('Collected', data.paid_total, 'success', 'Fines already paid') +
    card('Still growing', data.accruing_total, 'warning', `${data.overdue_count} overdue book(s) not yet returned`);
}

async function loadFines() {
  const status = document.getElementById('statusFilter').value;
  const { ok, data } = await api(`/api/fines?status=${status}`);
  if (!ok) return showMessage(data.error || 'Could not load fines', 'danger');

  const table = document.getElementById('fineTable');
  if (data.length === 0) {
    table.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No fines found</td></tr>';
    return;
  }

  table.innerHTML = data.map((f) => {
    const action = f.fine_paid
      ? '<span class="badge bg-success">Paid</span>'
      : `<button class="btn btn-sm btn-success" onclick="payFine(${f.issue_id}, ${f.fine_amount})">Mark as paid</button>`;

    return `<tr>
      <td>${f.issue_id}</td>
      <td>${escapeHtml(f.full_name)}<br><small class="text-muted">${escapeHtml(f.email)}</small></td>
      <td>${escapeHtml(f.title)}</td>
      <td>${f.due_date}</td>
      <td>${f.return_date}</td>
      <td>${f.late_days}</td>
      <td>${f.fine_amount}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function payFine(id, amount) {
  if (!confirm(`Confirm that Rs. ${amount} was received?`)) return;

  const { ok, data } = await api(`/api/fines/${id}/pay`, 'PUT');
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  loadSummary();
  loadFines();
}

document.getElementById('statusFilter').addEventListener('change', loadFines);

// ---------- Start ----------
if (requirePage('librarian')) {
  buildMenu();
  loadSummary();
  loadFines();
}