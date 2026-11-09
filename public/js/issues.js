const issueTable = document.getElementById('issueTable');

async function loadStudents() {
  const { data } = await api('/api/issues/students');
  document.getElementById('studentSelect').innerHTML =
    '<option value="">Select student</option>' +
    data.map((s) =>
      `<option value="${s.user_id}">${escapeHtml(s.full_name)} (${escapeHtml(s.email)})</option>`
    ).join('');
}

// Only books that have at least one free copy
async function loadAvailableBooks() {
  const { data } = await api('/api/books');
  const available = data.filter((b) => b.available_copies > 0);
  document.getElementById('bookSelect').innerHTML =
    '<option value="">Select book (only available books)</option>' +
    available.map((b) =>
      `<option value="${b.book_id}">${escapeHtml(b.title)} - ${b.available_copies} available</option>`
    ).join('');
}

async function loadIssues() {
  const status = document.getElementById('statusFilter').value;
  const { ok, data } = await api('/api/issues' + (status ? `?status=${status}` : ''));
  if (!ok) return showMessage(data.error || 'Could not load records', 'danger');

  if (data.length === 0) {
    issueTable.innerHTML =
      '<tr><td colspan="10" class="text-center text-muted py-4">No records found</td></tr>';
  } else {
    issueTable.innerHTML = data.map((i) => {
      let badge = '<span class="badge bg-primary">Issued</span>';
      if (i.return_date) badge = '<span class="badge bg-secondary">Returned</span>';
      else if (i.is_overdue) badge = '<span class="badge bg-danger">Overdue</span>';

      const action = i.return_date
        ? ''
        : `<button class="btn btn-sm btn-warning" onclick="returnBook(${i.issue_id})">Return</button>`;

      const fineText = !i.return_date && i.current_fine > 0
        ? `${i.current_fine} <small class="text-muted">so far</small>`
        : i.current_fine;

      return `<tr>
        <td>${i.issue_id}</td>
        <td>${escapeHtml(i.full_name)}</td>
        <td>${escapeHtml(i.title)}</td>
        <td>${i.issue_date}</td>
        <td>${i.due_date}</td>
        <td>${i.return_date ?? '-'}</td>
        <td>${i.late_days}</td>
        <td>${fineText}</td>
        <td>${badge}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
  }
  document.getElementById('resultCount').textContent = `${data.length} record(s)`;
}

document.getElementById('issueForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user_id = document.getElementById('studentSelect').value;
  const book_id = document.getElementById('bookSelect').value;

  const { ok, data } = await api('/api/issues', 'POST', { user_id, book_id });
  if (ok) {
    showMessage(`${data.book} issued to ${data.student}. Due date: ${data.due_date}`, 'success');
    document.getElementById('issueForm').reset();
  } else {
    showMessage(data.error, 'danger');
  }
  loadAvailableBooks();
  loadIssues();
});

async function returnBook(id) {
  if (!confirm('Record the return of this book?')) return;

  const { ok, data } = await api(`/api/issues/${id}/return`, 'PUT');
  if (ok) {
    const fineText = data.fine_amount > 0
      ? `Late by ${data.late_days} day(s). Fine: Rs. ${data.fine_amount}`
      : 'Returned on time. No fine.';
    showMessage(`Book returned. ${fineText}`, data.fine_amount > 0 ? 'warning' : 'success');
  } else {
    showMessage(data.error, 'danger');
  }
  loadAvailableBooks();
  loadIssues();
}

document.getElementById('statusFilter').addEventListener('change', loadIssues);

// ---------- Start ----------
if (requirePage('librarian')) {
  buildMenu();
  loadStudents();
  loadAvailableBooks();
  loadIssues();
}