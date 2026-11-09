// ---------- Who is logged in? ----------
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');
const isLibrarian = user && (user.role === 'librarian' || user.role === 'admin');

// Page elements
const bookTable = document.getElementById('bookTable');
const resultCount = document.getElementById('resultCount');
const categoryFilter = document.getElementById('categoryFilter');
const bookModal = new bootstrap.Modal(document.getElementById('bookModal'));

// Stops book text from being treated as HTML (protects against XSS)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function showMessage(text, type, targetId = 'message') {
  document.getElementById(targetId).innerHTML =
    `<div class="alert alert-${type}">${escapeHtml(text)}</div>`;
}

// Sends a request to the server; adds the token when logged in
async function api(url, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

// ---------- Top menu ----------
function buildMenu() {
  const links = document.getElementById('authLinks');
  if (!user) {
    links.innerHTML = `
      <li class="nav-item"><a class="nav-link" href="/books.html">Books</a></li>
      <li class="nav-item"><a class="nav-link" href="/login.html">Login</a></li>
      <li class="nav-item"><a class="nav-link" href="/register.html">Register</a></li>`;
    return;
  }

  const roleLinks = isLibrarian
    ? `<li class="nav-item"><a class="nav-link" href="/librarian-dashboard.html">Dashboard</a></li>
       <li class="nav-item"><a class="nav-link" href="/books.html">Books</a></li>
       <li class="nav-item"><a class="nav-link" href="/issues.html">Issue / Return</a></li>
       <li class="nav-item"><a class="nav-link" href="/renewals.html">Renewals</a></li>
       <li class="nav-item"><a class="nav-link" href="/reservations.html">Reservations</a></li>
       <li class="nav-item"><a class="nav-link" href="/fines.html">Fines</a></li>`
    : `<li class="nav-item"><a class="nav-link" href="/books.html">Books</a></li>
       <li class="nav-item"><a class="nav-link" href="/my-books.html">My Books</a></li>
       <li class="nav-item"><a class="nav-link" href="/renewals.html">Renewals</a></li>
       <li class="nav-item"><a class="nav-link" href="/reservations.html">Reservations</a></li>`;

  links.innerHTML = `
    ${roleLinks}
    <li class="nav-item text-white">${escapeHtml(user.full_name)} (${escapeHtml(user.role)})</li>
    <li class="nav-item"><button id="logoutBtn" class="btn btn-sm btn-outline-light">Logout</button></li>`;

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  });
}

// ---------- Load categories into the dropdown ----------
async function loadCategories() {
  const { data } = await api('/api/books/categories');
  const selected = categoryFilter.value;
  categoryFilter.innerHTML = '<option value="">All categories</option>' +
    data.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  categoryFilter.value = selected;
}

// ---------- Load and show books ----------
async function loadBooks() {
  const params = new URLSearchParams();
  const search = document.getElementById('searchInput').value.trim();
  if (search) params.append('search', search);
  if (categoryFilter.value) params.append('category', categoryFilter.value);

  const { ok, data } = await api('/api/books?' + params.toString());
  if (!ok) return showMessage(data.error || 'Could not load books', 'danger');

  const columns = isLibrarian ? 7 : 6;
  if (data.length === 0) {
    bookTable.innerHTML = `<tr><td colspan="${columns}" class="text-center text-muted py-4">No books found</td></tr>`;
  } else {
    bookTable.innerHTML = data.map((b) => {
      const waiting = b.pending_reservations || 0;
      // Copies that are free for walk-in students (not held for the queue)
      const free = b.available_copies - waiting;

      let badge;
      if (free > 0) {
        badge = `<span class="badge bg-success">${free} of ${b.total_copies} available</span>`;
      } else if (b.available_copies > 0) {
        badge = `<span class="badge bg-warning text-dark">Held for reservations</span>`;
      } else {
        badge = `<span class="badge bg-danger">Not available</span>`;
      }
      if (waiting > 0) {
        badge += ` <small class="text-muted">${waiting} waiting</small>`;
      }

      // Students can reserve when no free copy is left
      const reserveBtn = (user && !isLibrarian && free <= 0)
        ? `<button class="btn btn-sm btn-outline-primary ms-2" onclick="reserveBook(${b.book_id})">Reserve</button>`
        : '';

      const actions = isLibrarian ? `
        <td>
          <button class="btn btn-sm btn-outline-primary" onclick="openEditModal(${b.book_id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteBook(${b.book_id})">Delete</button>
        </td>` : '';

      return `<tr>
        <td>${escapeHtml(b.title)}</td>
        <td>${escapeHtml(b.author)}</td>
        <td>${escapeHtml(b.category)}</td>
        <td>${escapeHtml(b.isbn)}</td>
        <td>${escapeHtml(b.shelf_location)}</td>
        <td>${badge}${reserveBtn}</td>
        ${actions}
      </tr>`;
    }).join('');
  }
  resultCount.textContent = `${data.length} book(s) found`;
}

async function reserveBook(id) {
  const { ok, data } = await api('/api/reservations', 'POST', { book_id: id });
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  if (ok) loadBooks();
}

// ---------- Search buttons ----------
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  loadBooks();
});
document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('searchInput').value = '';
  categoryFilter.value = '';
  loadBooks();
});
categoryFilter.addEventListener('change', loadBooks);

// ---------- Add / Edit (librarian only) ----------
const fields = ['title', 'author', 'isbn', 'category', 'publisher',
                'publication_year', 'shelf_location', 'total_copies'];

document.getElementById('addBookBtn').addEventListener('click', () => {
  document.getElementById('bookForm').reset();
  document.getElementById('bookId').value = '';
  document.getElementById('total_copies').value = 1;
  document.getElementById('modalTitle').textContent = 'Add Book';
  document.getElementById('modalMessage').innerHTML = '';
  bookModal.show();
});

async function openEditModal(id) {
  const { ok, data } = await api(`/api/books/${id}`);
  if (!ok) return showMessage(data.error, 'danger');

  document.getElementById('bookId').value = data.book_id;
  fields.forEach((f) => (document.getElementById(f).value = data[f] ?? ''));
  document.getElementById('modalTitle').textContent = 'Edit Book';
  document.getElementById('modalMessage').innerHTML = '';
  bookModal.show();
}

document.getElementById('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const body = {};
  fields.forEach((f) => (body[f] = document.getElementById(f).value));

  const id = document.getElementById('bookId').value;
  const result = id
    ? await api(`/api/books/${id}`, 'PUT', body)
    : await api('/api/books', 'POST', body);

  if (result.ok) {
    bookModal.hide();
    showMessage(result.data.message, 'success');
    loadCategories();
    loadBooks();
  } else {
    showMessage(result.data.error, 'danger', 'modalMessage');
  }
});

async function deleteBook(id) {
  if (!confirm('Are you sure you want to delete this book?')) return;
  const { ok, data } = await api(`/api/books/${id}`, 'DELETE');
  showMessage(data.message || data.error, ok ? 'success' : 'danger');
  if (ok) {
    loadCategories();
    loadBooks();
  }
}

// ---------- Start ----------
buildMenu();
if (isLibrarian) {
  document.getElementById('addBookBtn').classList.remove('d-none');
  document.getElementById('actionsHeader').classList.remove('d-none');
}
loadCategories();
loadBooks();