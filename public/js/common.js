const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');
const isLibrarian = user && (user.role === 'librarian' || user.role === 'admin');

// Stops text from being treated as HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function showMessage(text, type, targetId = 'message') {
  document.getElementById(targetId).innerHTML =
    `<div class="alert alert-${type}">${escapeHtml(text)}</div>`;
}

// Sends a request to the server, adding the login token
async function api(url, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const data = await res.json();

  // Token expired or invalid: send the person back to login
  if (res.status === 401 && token) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  }
  return { ok: res.ok, status: res.status, data };
}

// Top menu
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

// Page guard. Returns true if the person may stay on this page.
// (This only improves the screen. The REAL protection is in the server.)
function requirePage(role) {
  if (!token || !user) {
    window.location.href = '/login.html';
    return false;
  }
  if (role === 'librarian' && !isLibrarian) {
    window.location.href = '/';
    return false;
  }
  return true;
}
// Underline the menu link of the page you are on
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#authLinks a.nav-link').forEach((a) => {
    if (a.getAttribute('href') === window.location.pathname) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    }
  });
});