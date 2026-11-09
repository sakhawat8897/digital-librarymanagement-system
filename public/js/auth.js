function showMessage(text, type) {
  document.getElementById('message').innerHTML =
    `<div class="alert alert-${type}">${text}</div>`;
}

// ---------- REGISTER ----------
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const full_name = document.getElementById('full_name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirm_password').value;

    if (password !== confirm) {
      return showMessage('Passwords do not match', 'danger');
    }

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password })
    });
    const data = await res.json();

    if (res.ok) {
      showMessage('Registration successful! Redirecting to login...', 'success');
      setTimeout(() => (window.location.href = '/login.html'), 1500);
    } else {
      showMessage(data.error, 'danger');
    }
  });
}

// ---------- LOGIN ----------
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (res.ok) {
      // Save the token in the browser
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      showMessage(`Welcome ${data.user.full_name} (${data.user.role})!`, 'success');
      // Dashboards come in a later step, so go home for now
      const page = (data.user.role === 'librarian' || data.user.role === 'admin')
  ? '/librarian-dashboard.html'
  : '/my-books.html';
setTimeout(() => (window.location.href = page), 1500);
    } else {
      showMessage(data.error, 'danger');
    }
  });
}