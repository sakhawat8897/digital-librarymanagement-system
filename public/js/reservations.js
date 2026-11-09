const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('reservationTable');

function statusBadge(r) {
  const colors = {
    pending: 'bg-warning text-dark',
    fulfilled: 'bg-success',
    cancelled: 'bg-secondary',
    expired: 'bg-dark'
  };
  const label = r.status.charAt(0).toUpperCase() + r.status.slice(1);
  return `<span class="badge ${colors[r.status]}">${label}</span>`;
}

async function loadReservations() {
  let url = '/api/reservations/my';
  if (isLibrarian) {
    const status = document.getElementById('statusFilter').value;
    url = '/api/reservations' + (status ? `?status=${status}` : '');
  }

  const { ok, data } = await api(url);
  if (!ok) return showMessage(data.error || 'Could not load reservations', 'danger');

  const headers = isLibrarian
    ? ['Student', 'Book', 'Reserved on', 'Expires', 'Queue #', 'Status', 'Action']
    : ['Book', 'Reserved on', 'Expires', 'Queue #', 'Status', 'Action'];
  tableHead.innerHTML = headers.map((h) => `<th>${h}</th>`).join('');

  if (data.length === 0) {
    tableBody.innerHTML =
      `<tr><td colspan="${headers.length}" class="text-center text-muted py-4">No reservations found</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map((r) => {
    const queue = r.status === 'pending' ? r.queue_position : '-';
    const cancelBtn = r.status === 'pending'
      ? `<button class="btn btn-sm btn-outline-danger" onclick="cancelReservation(${r.reservation_id})">Cancel</button>`
      : '';

    if (isLibrarian) {
      let action = '';
      if (r.status === 'pending') {
        action = r.copy_ready
          ? `<button class="btn btn-sm btn-success" onclick="issueFromReservation(${r.user_id}, ${r.book_id})">Issue now</button> `
          : '<small class="text-muted">Waiting for a copy</small> ';
        action += cancelBtn;
      }
      return `<tr>
        <td>${escapeHtml(r.full_name)}<br><small class="text-muted">${escapeHtml(r.email)}</small></td>
        <td>${escapeHtml(r.title)}</td>
        <td>${r.reservation_date}</td>
        <td>${r.expiry_date ?? '-'}</td>
        <td>${queue}</td>
        <td>${statusBadge(r)}</td>
        <td>${action}</td>
      </tr>`;
    }

    const ready = r.copy_ready
      ? '<span class="badge bg-success">Copy ready - visit the library</span> '
      : '';
    return `<tr>
      <td>${escapeHtml(r.title)}<br><small class="text-muted">${escapeHtml(r.author)}</small></td>
      <td>${r.reservation_date}</td>
      <td>${r.expiry_date ?? '-'}</td>
      <td>${queue}</td>
      <td>${statusBadge(r)}</td>
      <td>${ready}${cancelBtn}</td>
    </tr>`;
  }).join('');
}

async function cancelReservation(id) {
  if (!confirm('Cancel this reservation?')) return;
  const { ok, data } = await api(`/api/reservations/${id}/cancel`, 'PUT');
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  loadReservations();
}

// Librarian: issue the book to the student who reserved it
async function issueFromReservation(user_id, book_id) {
  if (!confirm('Issue this book to the student now?')) return;
  const { ok, data } = await api('/api/issues', 'POST', { user_id, book_id });
  showMessage(
    ok ? `${data.book} issued to ${data.student}. Due date: ${data.due_date}` : data.error,
    ok ? 'success' : 'danger'
  );
  loadReservations();
}

// ---------- Start ----------
if (requirePage()) {
  buildMenu();
  if (isLibrarian) {
    document.getElementById('pageTitle').textContent = 'Reservation Queue';
    document.getElementById('helpText').textContent =
      'Students are served in the order they reserved. "Issue now" appears when a copy is ready for that student.';
    document.getElementById('statusFilter').classList.remove('d-none');
    document.getElementById('statusFilter').addEventListener('change', loadReservations);
  } else {
    document.getElementById('pageTitle').textContent = 'My Reservations';
    document.getElementById('helpText').textContent =
      'To reserve a book, go to the Books page and click Reserve on a book that has no free copies.';
  }
  loadReservations();
}