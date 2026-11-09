async function loadStats() {
  const { ok, data } = await api('/api/dashboard/stats');
  if (!ok) return showMessage(data.error || 'Could not load statistics', 'danger');

  const card = (label, value, color, note, link) => `
    <div class="col-md-4">
      <a href="${link}" class="text-decoration-none">
        <div class="card shadow-sm border-${color} h-100">
          <div class="card-body text-center">
            <div class="text-muted">${label}</div>
            <div class="display-5 fw-bold text-${color}">${value}</div>
            <small class="text-muted">${note}</small>
          </div>
        </div>
      </a>
    </div>`;

  document.getElementById('stats').innerHTML =
    card('Total Books', data.total_titles, 'primary',
         `${data.total_copies} copies, ${data.available_copies} on the shelf`, '/books.html') +
    card('Issued Books', data.issued_books, 'primary', 'Currently with students', '/issues.html') +
    card('Students', data.students, 'primary', 'Registered members', '/issues.html') +
    card('Overdue Books', data.overdue_books, data.overdue_books > 0 ? 'danger' : 'success',
         'Past the due date', '#overdueTable') +
    card('Pending Reservations', data.pending_reservations, 'warning',
         'Students waiting for books', '/reservations.html') +
    card('Unpaid Fines (Rs.)', data.unpaid_fines, data.unpaid_fines > 0 ? 'danger' : 'success',
         'On returned books', '/fines.html');
}

async function loadOverdue() {
  const { ok, data } = await api('/api/dashboard/overdue');
  if (!ok) return showMessage(data.error || 'Could not load overdue books', 'danger');

  const table = document.getElementById('overdueTable');
  if (data.length === 0) {
    table.innerHTML = '<tr><td colspan="7" class="text-center text-success py-4">No overdue books</td></tr>';
  } else {
    table.innerHTML = data.map((r) => `<tr>
      <td>${escapeHtml(r.full_name)}<br><small class="text-muted">${escapeHtml(r.email)}</small></td>
      <td>${escapeHtml(r.title)}</td>
      <td>${r.issue_date}</td>
      <td>${r.due_date}</td>
      <td><span class="badge bg-danger">${r.late_days}</span></td>
      <td>${r.fine_amount} <small class="text-muted">so far</small></td>
      <td><button class="btn btn-sm btn-warning" onclick="returnBook(${r.issue_id})">Return</button></td>
    </tr>`).join('');
  }
  document.getElementById('overdueCount').textContent = `${data.length} overdue book(s)`;
}

async function returnBook(id) {
  if (!confirm('Record the return of this book?')) return;
  const { ok, data } = await api(`/api/issues/${id}/return`, 'PUT');
  if (ok) {
    showMessage(
      data.fine_amount > 0
        ? `Book returned. Late by ${data.late_days} day(s). Fine: Rs. ${data.fine_amount}`
        : 'Book returned. No fine.',
      data.fine_amount > 0 ? 'warning' : 'success'
    );
  } else {
    showMessage(data.error, 'danger');
  }
  loadStats();
  loadOverdue();
}

// ---------- Start ----------
if (requirePage('librarian')) {
  buildMenu();
  loadStats();
  loadOverdue();
}