async function loadMyBooks() {
  const [issuesRes, eligibleRes] = await Promise.all([
    api('/api/issues/my'),
    api('/api/renewals/eligible')
  ]);
  if (!issuesRes.ok) return showMessage(issuesRes.data.error || 'Could not load your books', 'danger');

  const data = issuesRes.data;
  const eligible = {};
  if (eligibleRes.ok) eligibleRes.data.forEach((e) => (eligible[e.issue_id] = e));

  const borrowed = data.filter((i) => !i.return_date).length;
  const overdue = data.filter((i) => i.is_overdue).length;
  const fines = data.filter((i) => !i.fine_paid).reduce((sum, i) => sum + i.current_fine, 0);

  const card = (label, value, color) => `
    <div class="col-md-4">
      <div class="card shadow-sm border-${color}">
        <div class="card-body text-center">
          <div class="text-muted">${label}</div>
          <div class="display-6 fw-bold text-${color}">${value}</div>
        </div>
      </div>
    </div>`;

  document.getElementById('summary').innerHTML =
    card('Currently borrowed', borrowed, 'primary') +
    card('Overdue', overdue, overdue > 0 ? 'danger' : 'success') +
    card('Fines (Rs.)', fines, fines > 0 ? 'danger' : 'success');

  const table = document.getElementById('myTable');
  if (data.length === 0) {
    table.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">You have not borrowed any books yet</td></tr>';
    return;
  }

  table.innerHTML = data.map((i) => {
    let badge = '<span class="badge bg-primary">Issued</span>';
    if (i.return_date) badge = '<span class="badge bg-secondary">Returned</span>';
    else if (i.is_overdue) badge = `<span class="badge bg-danger">Overdue (${i.late_days} days)</span>`;

    let fineCell = `${i.current_fine}`;
    if (i.return_date && i.current_fine > 0) {
      fineCell += i.fine_paid
        ? ' <span class="badge bg-success">Paid</span>'
        : ' <span class="badge bg-danger">Unpaid</span>';
    }

    // Renewal column: only for books that are still borrowed
    let renewCell = '';
    const e = eligible[i.issue_id];
    if (!i.return_date && e) {
      renewCell = e.can_renew
        ? `<button class="btn btn-sm btn-outline-primary" onclick="requestRenewal(${i.issue_id})">Renew</button>
           <br><small class="text-muted">${e.renewals_left} renewal(s) left</small>`
        : `<small class="text-muted">${escapeHtml(e.reason)}</small>`;
    }

    return `<tr>
      <td>${escapeHtml(i.title)}</td>
      <td>${escapeHtml(i.author)}</td>
      <td>${i.issue_date}</td>
      <td>${i.due_date}</td>
      <td>${i.return_date ?? '-'}</td>
      <td>${fineCell}</td>
      <td>${badge}</td>
      <td>${renewCell}</td>
    </tr>`;
  }).join('');
}

async function requestRenewal(issueId) {
  if (!confirm('Request a renewal for this book?')) return;
  const { ok, data } = await api('/api/renewals', 'POST', { issue_id: issueId });
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  loadMyBooks();
}

if (requirePage()) {
  buildMenu();
  loadMyBooks();
}