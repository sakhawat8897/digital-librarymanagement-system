const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('renewalTable');

function statusBadge(status) {
  const colors = { pending: 'bg-warning text-dark', approved: 'bg-success', rejected: 'bg-secondary' };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="badge ${colors[status]}">${label}</span>`;
}

async function loadRenewals() {
  let url = '/api/renewals/my';
  if (isLibrarian) {
    const status = document.getElementById('statusFilter').value;
    url = '/api/renewals' + (status ? `?status=${status}` : '');
  }

  const { ok, data } = await api(url);
  if (!ok) return showMessage(data.error || 'Could not load renewals', 'danger');

  const headers = isLibrarian
    ? ['Student', 'Book', 'Requested on', 'Due date now', 'New due date', 'Renewals used', 'Status', 'Action']
    : ['Book', 'Requested on', 'Due date then', 'New due date', 'Status'];
  tableHead.innerHTML = headers.map((h) => `<th>${h}</th>`).join('');

  if (data.length === 0) {
    tableBody.innerHTML =
      `<tr><td colspan="${headers.length}" class="text-center text-muted py-4">No renewal requests found</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map((r) => {
    if (!isLibrarian) {
      return `<tr>
        <td>${escapeHtml(r.title)}<br><small class="text-muted">${escapeHtml(r.author)}</small></td>
        <td>${r.request_date}</td>
        <td>${r.old_due_date}</td>
        <td>${r.new_due_date}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
    }

    let action = '';
    if (r.status === 'pending') {
      action = r.can_approve
        ? `<button class="btn btn-sm btn-success" onclick="approveRenewal(${r.renewal_id})">Approve</button> `
        : `<small class="text-danger d-block">${escapeHtml(r.blocked_reason)}</small>`;
      action += `<button class="btn btn-sm btn-outline-danger" onclick="rejectRenewal(${r.renewal_id})">Reject</button>`;
    }

    return `<tr>
      <td>${escapeHtml(r.full_name)}<br><small class="text-muted">${escapeHtml(r.email)}</small></td>
      <td>${escapeHtml(r.title)}</td>
      <td>${r.request_date}</td>
      <td>${r.old_due_date}</td>
      <td>${r.new_due_date}</td>
      <td>${r.renewal_count}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function approveRenewal(id) {
  if (!confirm('Approve this renewal?')) return;
  const { ok, data } = await api(`/api/renewals/${id}/approve`, 'PUT');
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  loadRenewals();
}

async function rejectRenewal(id) {
  if (!confirm('Reject this renewal request?')) return;
  const { ok, data } = await api(`/api/renewals/${id}/reject`, 'PUT');
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  loadRenewals();
}

// ---------- Start ----------
if (requirePage()) {
  buildMenu();
  if (isLibrarian) {
    document.getElementById('pageTitle').textContent = 'Renewal Requests';
    document.getElementById('helpText').textContent =
      'Approving adds the renewal period to the current due date. Requests that break a rule show the reason.';
    document.getElementById('statusFilter').classList.remove('d-none');
    document.getElementById('statusFilter').addEventListener('change', loadRenewals);
  } else {
    document.getElementById('pageTitle').textContent = 'My Renewal Requests';
    document.getElementById('helpText').textContent =
      'To renew a book, go to My Books and click Renew next to the book.';
  }
  loadRenewals();
}