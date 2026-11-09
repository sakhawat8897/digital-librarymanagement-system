// Full test pass for the Digital Library Management System.
// Starts its own server on port 3100 with a TEMPORARY database.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

let bcrypt;
try { bcrypt = require('bcryptjs'); } catch (e) { bcrypt = require('bcrypt'); }

const ROOT = path.join(__dirname, '..');
const {
  LOAN_DAYS, FINE_PER_DAY, RENEWAL_DAYS, MAX_RENEWALS, todayLocal, addDays
} = require(path.join(ROOT, 'utils', 'library'));

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const DB_FILE = path.join(os.tmpdir(), `library-test-${Date.now()}.db`);

// ---------- tiny test framework ----------
let passed = 0;
let failed = 0;
const failures = [];
let serverErrors = '';

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function check(name, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  [FAIL] ${name}${details ? '  -> ' + details : ''}`);
  }
}

function expectStatus(name, res, status) {
  check(name, res.status === status,
    `expected ${status}, got ${res.status} ${JSON.stringify(res.data)}`);
}

const arr = (res) => (Array.isArray(res.data) ? res.data : []);

async function call(method, url, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}

const login = (email, password) => call('POST', '/api/auth/login', null, { email, password });

async function registerAndLogin(name, email) {
  const reg = await call('POST', '/api/auth/register', null,
    { full_name: name, email, password: '123456' });
  const log = await login(email, '123456');
  return {
    reg,
    token: log.data && log.data.token,
    id: log.data && log.data.user && log.data.user.user_id
  };
}

const bookBody = (isbn, title, author, category, copies) => ({
  isbn, title, author, category,
  publisher: 'Test Press', publication_year: 2020, shelf_location: 'T-01', total_copies: copies
});

// ---------- the tests ----------
async function runTests(db) {
  const LATE = 3;

  // Moves an issue into the past so it becomes overdue
  function backdate(issueId, days) {
    const i = db.prepare('SELECT issue_date, due_date FROM issues WHERE issue_id = ?').get(issueId);
    db.prepare('UPDATE issues SET issue_date = ?, due_date = ? WHERE issue_id = ?')
      .run(addDays(i.issue_date, -days), addDays(i.due_date, -days), issueId);
  }

  let r;

  // ===== 1. Authentication =====
  section('1. Server and authentication');
  r = await call('GET', '/api/health');
  expectStatus('Server is running (health check)', r, 200);

  const sara = await registerAndLogin('Sara Ahmed', 'sara@test.com');
  expectStatus('Student registration works', sara.reg, 201);
  const ali = await registerAndLogin('Ali Khan', 'ali@test.com');
  const omar = await registerAndLogin('Omar Raza', 'omar@test.com');
  check('Students can log in and receive a JWT', !!(sara.token && ali.token && omar.token));

  r = await call('POST', '/api/auth/register', null,
    { full_name: 'Sara Two', email: 'sara@test.com', password: '123456' });
  expectStatus('Duplicate email is rejected', r, 409);
  r = await call('POST', '/api/auth/register', null, {});
  expectStatus('Registration with missing fields is rejected', r, 400);
  r = await call('POST', '/api/auth/register', null,
    { full_name: 'Short', email: 'short@test.com', password: '123' });
  expectStatus('Too-short password is rejected', r, 400);

  await call('POST', '/api/auth/register', null,
    { full_name: 'Sneaky', email: 'sneaky@test.com', password: '123456', role: 'librarian' });
  const sneaky = await login('sneaky@test.com', '123456');
  check('Registering with role "librarian" still creates a student only',
    !!(sneaky.data && sneaky.data.user && sneaky.data.user.role === 'member'));

  const hashRow = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('sara@test.com');
  check('Password is stored hashed, not as plain text',
    hashRow.password_hash !== '123456' && hashRow.password_hash.startsWith('$2'));

  r = await login('sara@test.com', 'wrong-password');
  expectStatus('Wrong password is rejected', r, 401);
  r = await login('nobody@test.com', '123456');
  expectStatus('Unknown email is rejected', r, 401);

  const lib = await login('lib@test.com', 'librarian123');
  expectStatus('Librarian login works', lib, 200);
  const LIB = lib.data.token;
  const LIB_ID = lib.data.user.user_id;
  check('Librarian token carries the librarian role', lib.data.user.role === 'librarian');

  r = await call('GET', '/api/auth/me', sara.token);
  expectStatus('Valid JWT is accepted', r, 200);
  r = await call('GET', '/api/auth/me');
  expectStatus('Request with no token is blocked', r, 401);
  r = await call('GET', '/api/auth/me', 'abc.def.ghi');
  expectStatus('Fake token is blocked', r, 401);
  r = await call('GET', '/api/auth/librarian-check', sara.token);
  expectStatus('Student cannot use a librarian route', r, 403);
  r = await call('GET', '/api/auth/librarian-check', LIB);
  expectStatus('Librarian can use a librarian route', r, 200);

  // ===== 2. Book catalog =====
  section('2. Book catalog');
  r = await call('GET', '/api/books');
  expectStatus('Anyone can view the catalog', r, 200);

  r = await call('POST', '/api/books', null, bookBody('T-001', 'Test Algorithms', 'Maria Test', 'Computer Science', 3));
  expectStatus('Adding a book without login is blocked', r, 401);
  r = await call('POST', '/api/books', sara.token, bookBody('T-001', 'Test Algorithms', 'Maria Test', 'Computer Science', 3));
  expectStatus('Student cannot add a book', r, 403);

  r = await call('POST', '/api/books', LIB, bookBody('T-001', 'Test Algorithms', 'Maria Test', 'Computer Science', 3));
  expectStatus('Librarian can add a book', r, 201);
  const bookA = r.data.book_id;
  r = await call('POST', '/api/books', LIB, bookBody('T-002', 'Queue Test', 'Queue Author', 'Computer Science', 1));
  const bookB = r.data.book_id;
  r = await call('POST', '/api/books', LIB, bookBody('T-003', 'Test Calculus', 'Hina Test', 'Mathematics', 2));
  const bookC = r.data.book_id;
  r = await call('POST', '/api/books', LIB, bookBody('T-004', 'Single Copy Test', 'Solo Author', 'Science', 1));
  const bookE = r.data.book_id;

  r = await call('POST', '/api/books', LIB, bookBody('T-001', 'Another', 'Someone', 'X', 1));
  expectStatus('Duplicate ISBN is rejected', r, 409);
  r = await call('POST', '/api/books', LIB, { title: 'No ISBN' });
  expectStatus('Missing book fields are rejected', r, 400);
  r = await call('POST', '/api/books', LIB, bookBody('T-050', 'Negative', 'Someone', 'X', -1));
  expectStatus('Negative copies are rejected', r, 400);
  r = await call('POST', '/api/books', LIB, { ...bookBody('T-051', 'Bad Year', 'Someone', 'X', 1), publication_year: 3000 });
  expectStatus('Invalid publication year is rejected', r, 400);

  r = await call('GET', '/api/books?search=Algorithms');
  check('Search by title works', arr(r).some((b) => b.book_id === bookA));
  r = await call('GET', '/api/books?search=Maria');
  check('Search by author works', arr(r).some((b) => b.book_id === bookA));
  r = await call('GET', '/api/books?category=Mathematics');
  check('Filter by category works',
    arr(r).some((b) => b.book_id === bookC) && arr(r).every((b) => b.category === 'Mathematics'));
  r = await call('GET', '/api/books?search=zzzznotabook');
  check('Search with no match returns an empty list', r.status === 200 && arr(r).length === 0);
  r = await call('GET', '/api/books/categories');
  check('Category list works', arr(r).includes('Mathematics'));
  r = await call('GET', `/api/books/${bookA}`);
  expectStatus('View one book', r, 200);
  r = await call('GET', '/api/books/99999');
  expectStatus('Missing book returns 404', r, 404);

  r = await call('PUT', `/api/books/${bookA}`, sara.token, { total_copies: 5 });
  expectStatus('Student cannot update a book', r, 403);
  r = await call('PUT', `/api/books/${bookA}`, LIB, { total_copies: 4 });
  expectStatus('Librarian can update a book', r, 200);
  r = await call('GET', `/api/books/${bookA}`);
  check('Updating total copies also updates available copies',
    r.data.total_copies === 4 && r.data.available_copies === 4);

  r = await call('POST', '/api/books', LIB, bookBody('T-099', 'Delete Me', 'Nobody', 'Misc', 1));
  const tempBook = r.data.book_id;
  r = await call('DELETE', `/api/books/${tempBook}`, sara.token);
  expectStatus('Student cannot delete a book', r, 403);
  r = await call('DELETE', `/api/books/${tempBook}`, LIB);
  expectStatus('Librarian can delete a book', r, 200);
  r = await call('DELETE', `/api/books/${tempBook}`, LIB);
  expectStatus('Deleting a missing book returns 404', r, 404);

  // ===== 3. Issue and return =====
  section('3. Issue and return');
  r = await call('GET', '/api/issues/students', LIB);
  check('Librarian can list students', r.status === 200 && arr(r).some((s) => s.user_id === sara.id));
  r = await call('GET', '/api/issues/students', sara.token);
  expectStatus('Student cannot list students', r, 403);

  r = await call('GET', `/api/books/${bookA}`);
  const availBefore = r.data.available_copies;

  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookA });
  expectStatus('Librarian can issue a book', r, 201);
  const issue1 = r.data.issue_id;
  check('Due date = issue date + loan days', r.data.due_date === addDays(todayLocal(), LOAN_DAYS),
    `got ${r.data.due_date}`);
  r = await call('GET', `/api/books/${bookA}`);
  check('Available copies go down by 1 after issuing', r.data.available_copies === availBefore - 1);

  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookA });
  expectStatus('Same student cannot hold the same book twice', r, 409);
  r = await call('POST', '/api/issues', LIB, {});
  expectStatus('Issue with missing fields is rejected', r, 400);
  r = await call('POST', '/api/issues', LIB, { user_id: 99999, book_id: bookA });
  expectStatus('Issue to a missing student returns 404', r, 404);
  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: 99999 });
  expectStatus('Issue of a missing book returns 404', r, 404);
  r = await call('POST', '/api/issues', LIB, { user_id: LIB_ID, book_id: bookA });
  expectStatus('Books cannot be issued to the librarian account', r, 400);
  r = await call('POST', '/api/issues', sara.token, { user_id: sara.id, book_id: bookC });
  expectStatus('Student cannot issue books', r, 403);
  r = await call('POST', '/api/issues', null, { user_id: sara.id, book_id: bookC });
  expectStatus('Issue without login is blocked', r, 401);

  r = await call('GET', '/api/issues/my', sara.token);
  check("Student sees their own issued book", arr(r).some((i) => i.issue_id === issue1));
  r = await call('GET', '/api/issues/my', ali.token);
  check("Student does NOT see another student's books", !arr(r).some((i) => i.issue_id === issue1));
  r = await call('GET', '/api/issues', LIB);
  check('Librarian can list all issues', r.status === 200 && arr(r).some((i) => i.issue_id === issue1));
  r = await call('GET', '/api/issues', sara.token);
  expectStatus('Student cannot list all issues', r, 403);
  r = await call('GET', '/api/issues?status=active', LIB);
  check('Active filter works', arr(r).some((i) => i.issue_id === issue1));

  r = await call('DELETE', `/api/books/${bookA}`, LIB);
  expectStatus('A book with borrowing history cannot be deleted', r, 409);

  r = await call('PUT', `/api/issues/${issue1}/return`, sara.token);
  expectStatus('Student cannot record a return', r, 403);
  r = await call('PUT', `/api/issues/${issue1}/return`, LIB);
  expectStatus('Librarian can return a book', r, 200);
  check('On-time return has no fine', r.data.fine_amount === 0);
  r = await call('GET', `/api/books/${bookA}`);
  check('Available copies go back up after return', r.data.available_copies === availBefore);
  r = await call('PUT', `/api/issues/${issue1}/return`, LIB);
  expectStatus('Returning twice is rejected', r, 409);
  r = await call('PUT', '/api/issues/99999/return', LIB);
  expectStatus('Returning a missing record returns 404', r, 404);
  r = await call('GET', '/api/issues?status=returned', LIB);
  check('Returned filter works', arr(r).some((i) => i.issue_id === issue1));

  // The last copy of book B
  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookB });
  expectStatus('Issue the only copy of a book', r, 201);
  const issueB_sara = r.data.issue_id;
  r = await call('POST', '/api/issues', LIB, { user_id: ali.id, book_id: bookB });
  expectStatus('A book with no free copies cannot be issued', r, 409);
  r = await call('PUT', `/api/books/${bookB}`, LIB, { total_copies: 0 });
  expectStatus('Total copies cannot go below the number issued', r, 400);

  // ===== 4. Fines =====
  section('4. Fines');
  r = await call('POST', '/api/issues', LIB, { user_id: ali.id, book_id: bookC });
  const issueC = r.data.issue_id;
  backdate(issueC, LOAN_DAYS + LATE);

  r = await call('GET', '/api/issues?status=overdue', LIB);
  const overdueRow = arr(r).find((i) => i.issue_id === issueC);
  check('Overdue book appears in the overdue filter', !!overdueRow);
  check('Late days are calculated correctly', !!overdueRow && overdueRow.late_days === LATE,
    overdueRow ? `got ${overdueRow.late_days}` : '');
  check('Running fine = late days x daily rate',
    !!overdueRow && overdueRow.current_fine === LATE * FINE_PER_DAY);

  r = await call('GET', '/api/dashboard/overdue', LIB);
  const dashRow = arr(r).find((i) => i.issue_id === issueC);
  check('Overdue list shows student, book, late days and fine',
    !!dashRow && !!dashRow.full_name && !!dashRow.title &&
    dashRow.late_days === LATE && dashRow.fine_amount === LATE * FINE_PER_DAY);

  r = await call('GET', '/api/fines/summary', LIB);
  check('Fine summary shows the growing fine', r.status === 200 && r.data.accruing_total === LATE * FINE_PER_DAY,
    JSON.stringify(r.data));

  r = await call('PUT', `/api/issues/${issueC}/return`, LIB);
  expectStatus('Late book can be returned', r, 200);
  check('Fine is calculated automatically on return',
    r.data.fine_amount === LATE * FINE_PER_DAY && r.data.late_days === LATE,
    JSON.stringify(r.data));

  r = await call('GET', '/api/fines?status=unpaid', LIB);
  check('Unpaid fine appears in the fines list',
    arr(r).some((f) => f.issue_id === issueC && f.fine_amount === LATE * FINE_PER_DAY));
  r = await call('GET', '/api/fines', ali.token);
  expectStatus('Student cannot view the fines list', r, 403);
  r = await call('GET', '/api/fines/summary');
  expectStatus('Fine summary without login is blocked', r, 401);

  r = await call('POST', '/api/issues', LIB, { user_id: ali.id, book_id: bookA });
  expectStatus('Student with an unpaid fine cannot borrow', r, 403);

  r = await call('PUT', `/api/fines/${issueC}/pay`, ali.token);
  expectStatus('Student cannot mark their own fine as paid', r, 403);
  r = await call('PUT', `/api/fines/${issueB_sara}/pay`, LIB);
  expectStatus('Fine cannot be paid before the book is returned', r, 400);
  r = await call('PUT', `/api/fines/${issue1}/pay`, LIB);
  expectStatus('A record with no fine cannot be paid', r, 400);
  r = await call('PUT', '/api/fines/99999/pay', LIB);
  expectStatus('Paying a missing record returns 404', r, 404);
  r = await call('PUT', `/api/fines/${issueC}/pay`, LIB);
  expectStatus('Librarian can mark a fine as paid', r, 200);
  r = await call('PUT', `/api/fines/${issueC}/pay`, LIB);
  expectStatus('Paying the same fine twice is rejected', r, 409);
  r = await call('GET', '/api/fines?status=paid', LIB);
  check('Paid fine appears in the paid list', arr(r).some((f) => f.issue_id === issueC));
  r = await call('GET', '/api/fines/summary', LIB);
  check('Collected total includes the paid fine', r.data.paid_total >= LATE * FINE_PER_DAY);

  r = await call('POST', '/api/issues', LIB, { user_id: ali.id, book_id: bookC });
  expectStatus('After paying, the student can borrow again', r, 201);
  const issueC2 = r.data.issue_id;
  r = await call('PUT', `/api/issues/${issueC2}/return`, LIB);
  expectStatus('Return the second copy', r, 200);
  r = await call('GET', '/api/issues/my', ali.token);
  const aliFine = arr(r).find((i) => i.issue_id === issueC);
  check('Student sees the fine as paid', !!aliFine && Number(aliFine.fine_paid) === 1);

  // ===== 5. Reservations =====
  section('5. Reservations');
  // Book B: 1 copy, currently held by Sara
  r = await call('POST', '/api/reservations', ali.token, { book_id: bookB });
  expectStatus('Student can reserve a book with no free copies', r, 201);
  check('First in the queue gets position 1', r.data.queue_position === 1);
  r = await call('POST', '/api/reservations', omar.token, { book_id: bookB });
  expectStatus('A second student can reserve the same book', r, 201);
  check('Second student gets position 2', r.data.queue_position === 2);
  const resOmar = r.data.reservation_id;

  r = await call('POST', '/api/reservations', ali.token, { book_id: bookB });
  expectStatus('Duplicate reservation is rejected', r, 409);
  r = await call('POST', '/api/reservations', sara.token, { book_id: bookB });
  expectStatus('The student holding the book cannot reserve it', r, 409);
  r = await call('POST', '/api/reservations', ali.token, { book_id: bookA });
  expectStatus('A book with free copies cannot be reserved', r, 409);
  r = await call('POST', '/api/reservations', ali.token, { book_id: 99999 });
  expectStatus('Reserving a missing book returns 404', r, 404);
  r = await call('POST', '/api/reservations', ali.token, {});
  expectStatus('Reservation with missing fields is rejected', r, 400);
  r = await call('POST', '/api/reservations', LIB, { book_id: bookB });
  expectStatus('Librarian cannot reserve books', r, 403);
  r = await call('POST', '/api/reservations', null, { book_id: bookB });
  expectStatus('Reserving without login is blocked', r, 401);

  r = await call('GET', '/api/reservations/my', ali.token);
  const aliRes = arr(r).find((x) => x.book_id === bookB && x.status === 'pending');
  check('Student sees their own reservation with queue position', !!aliRes && aliRes.queue_position === 1);
  r = await call('GET', '/api/reservations?status=pending', LIB);
  const pendingList = arr(r);
  check('Librarian sees the whole queue', pendingList.filter((x) => x.book_id === bookB).length === 2);
  check('No copy is ready while the book is still out',
    pendingList.filter((x) => x.book_id === bookB).every((x) => x.copy_ready === false));
  r = await call('GET', '/api/reservations', ali.token);
  expectStatus('Student cannot view the full queue', r, 403);
  r = await call('GET', '/api/books');
  const bRow = arr(r).find((b) => b.book_id === bookB);
  check('Catalog shows how many students are waiting', !!bRow && bRow.pending_reservations === 2);

  r = await call('PUT', `/api/issues/${issueB_sara}/return`, LIB);
  expectStatus('Return the reserved book', r, 200);
  r = await call('GET', '/api/reservations?status=pending', LIB);
  const afterReturn = arr(r).filter((x) => x.book_id === bookB);
  const firstInLine = afterReturn.find((x) => x.user_id === ali.id);
  const secondInLine = afterReturn.find((x) => x.user_id === omar.id);
  check('The first student in the queue is marked "copy ready"', !!firstInLine && firstInLine.copy_ready === true);
  check('The second student is still waiting', !!secondInLine && secondInLine.copy_ready === false);

  r = await call('POST', '/api/issues', LIB, { user_id: omar.id, book_id: bookB });
  expectStatus('Cannot skip the queue (second student)', r, 409);
  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookB });
  expectStatus('Walk-in student cannot take a copy held for the queue', r, 409);
  r = await call('POST', '/api/issues', LIB, { user_id: ali.id, book_id: bookB });
  expectStatus('First student in the queue can be issued the book', r, 201);
  const issueB_ali = r.data.issue_id;
  r = await call('GET', '/api/reservations/my', ali.token);
  check('Reservation becomes "fulfilled" after issuing',
    arr(r).some((x) => x.reservation_id === aliRes.reservation_id && x.status === 'fulfilled'));
  r = await call('GET', '/api/reservations/my', omar.token);
  const omarNow = arr(r).find((x) => x.reservation_id === resOmar);
  check('Next student moves up to position 1', !!omarNow && omarNow.queue_position === 1);

  r = await call('POST', '/api/reservations', sara.token, { book_id: bookB });
  const resSara = r.data.reservation_id;
  r = await call('PUT', `/api/reservations/${resSara}/cancel`, ali.token);
  expectStatus("Student cannot cancel another student's reservation", r, 403);
  r = await call('PUT', `/api/reservations/${resOmar}/cancel`, omar.token);
  expectStatus('Student can cancel their own reservation', r, 200);
  r = await call('PUT', `/api/reservations/${resOmar}/cancel`, omar.token);
  expectStatus('Cancelling twice is rejected', r, 409);
  r = await call('PUT', `/api/reservations/${resSara}/cancel`, sara.token);
  expectStatus('Second cancellation works', r, 200);

  r = await call('POST', '/api/reservations', omar.token, { book_id: bookB });
  const resOmar2 = r.data.reservation_id;
  db.prepare("UPDATE reservations SET expiry_date = '2020-01-01' WHERE reservation_id = ?").run(resOmar2);
  r = await call('GET', '/api/reservations/my', omar.token);
  check('Old reservations expire automatically',
    arr(r).some((x) => x.reservation_id === resOmar2 && x.status === 'expired'));

  // ===== 6. Renewals =====
  section('6. Renewals');
  // Book B is now held by Ali, nobody else is waiting
  r = await call('GET', '/api/renewals/eligible', ali.token);
  const elig = arr(r).find((x) => x.issue_id === issueB_ali);
  check('Eligible list says the book can be renewed', !!elig && elig.can_renew === true, JSON.stringify(elig));

  r = await call('GET', '/api/issues/my', ali.token);
  const dueBefore = arr(r).find((i) => i.issue_id === issueB_ali).due_date;

  r = await call('POST', '/api/renewals', ali.token, { issue_id: issueB_ali });
  expectStatus('Student can request a renewal', r, 201);
  check('New due date = current due date + renewal days', r.data.new_due_date === addDays(dueBefore, RENEWAL_DAYS),
    `got ${r.data.new_due_date}`);
  const renew1 = r.data.renewal_id;

  r = await call('POST', '/api/renewals', ali.token, { issue_id: issueB_ali });
  expectStatus('Duplicate pending request is rejected', r, 409);
  r = await call('POST', '/api/renewals', sara.token, { issue_id: issueB_ali });
  expectStatus("Student cannot renew someone else's book", r, 403);
  r = await call('POST', '/api/renewals', ali.token, {});
  expectStatus('Renewal with missing fields is rejected', r, 400);
  r = await call('POST', '/api/renewals', ali.token, { issue_id: 99999 });
  expectStatus('Renewal of a missing record returns 404', r, 404);
  r = await call('POST', '/api/renewals', LIB, { issue_id: issueB_ali });
  expectStatus('Librarian cannot request renewals', r, 403);
  r = await call('POST', '/api/renewals', null, { issue_id: issueB_ali });
  expectStatus('Renewal without login is blocked', r, 401);

  r = await call('GET', '/api/renewals', ali.token);
  expectStatus('Student cannot list all renewal requests', r, 403);
  r = await call('GET', '/api/renewals?status=pending', LIB);
  const pend = arr(r).find((x) => x.renewal_id === renew1);
  check('Librarian sees the pending request and can approve it', !!pend && pend.can_approve === true);

  r = await call('PUT', `/api/renewals/${renew1}/approve`, ali.token);
  expectStatus('Student cannot approve renewals', r, 403);
  r = await call('PUT', `/api/renewals/${renew1}/approve`, LIB);
  expectStatus('Librarian can approve a renewal', r, 200);
  r = await call('GET', '/api/issues/my', ali.token);
  check('Due date moves forward after approval',
    arr(r).find((i) => i.issue_id === issueB_ali).due_date === addDays(dueBefore, RENEWAL_DAYS));
  r = await call('PUT', `/api/renewals/${renew1}/approve`, LIB);
  expectStatus('Approving twice is rejected', r, 409);

  for (let n = 2; n <= MAX_RENEWALS; n++) {
    r = await call('POST', '/api/renewals', ali.token, { issue_id: issueB_ali });
    await call('PUT', `/api/renewals/${r.data.renewal_id}/approve`, LIB);
  }
  r = await call('POST', '/api/renewals', ali.token, { issue_id: issueB_ali });
  check('Maximum number of renewals is enforced',
    r.status === 409 && /maximum/i.test((r.data && r.data.error) || ''), JSON.stringify(r.data));

  // Rejection
  r = await call('POST', '/api/issues', LIB, { user_id: omar.id, book_id: bookA });
  const issueA_omar = r.data.issue_id;
  r = await call('POST', '/api/renewals', omar.token, { issue_id: issueA_omar });
  const renew2 = r.data.renewal_id;
  r = await call('PUT', `/api/renewals/${renew2}/reject`, LIB);
  expectStatus('Librarian can reject a renewal', r, 200);
  r = await call('PUT', `/api/renewals/${renew2}/reject`, LIB);
  expectStatus('Rejecting twice is rejected', r, 409);
  r = await call('PUT', `/api/renewals/${renew2}/approve`, LIB);
  expectStatus('A rejected request cannot be approved', r, 409);
  r = await call('PUT', '/api/renewals/99999/approve', LIB);
  expectStatus('Approving a missing request returns 404', r, 404);

  // Overdue
  backdate(issueA_omar, LOAN_DAYS + LATE);
  r = await call('POST', '/api/renewals', omar.token, { issue_id: issueA_omar });
  check('An overdue book cannot be renewed',
    r.status === 409 && /overdue/i.test((r.data && r.data.error) || ''), JSON.stringify(r.data));
  r = await call('PUT', `/api/issues/${issueA_omar}/return`, LIB);
  expectStatus('Return the overdue book (leaves an unpaid fine)', r, 200);

  // Another student reserved the book
  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookE });
  const issueE = r.data.issue_id;
  r = await call('POST', '/api/reservations', ali.token, { book_id: bookE });
  expectStatus('Another student reserves the book', r, 201);
  r = await call('POST', '/api/renewals', sara.token, { issue_id: issueE });
  check('A book reserved by someone else cannot be renewed',
    r.status === 409 && /reserved/i.test((r.data && r.data.error) || ''), JSON.stringify(r.data));
  await call('PUT', `/api/issues/${issueE}/return`, LIB);

  // Returning clears a pending request
  r = await call('POST', '/api/issues', LIB, { user_id: sara.id, book_id: bookA });
  const issueA_sara = r.data.issue_id;
  r = await call('POST', '/api/renewals', sara.token, { issue_id: issueA_sara });
  const renewX = r.data.renewal_id;
  await call('PUT', `/api/issues/${issueA_sara}/return`, LIB);
  r = await call('GET', '/api/renewals?status=rejected', LIB);
  check('Returning a book rejects its pending renewal request',
    arr(r).some((x) => x.renewal_id === renewX));
  r = await call('GET', '/api/renewals/my', sara.token);
  check('Student can see their renewal history', arr(r).some((x) => x.renewal_id === renewX));

  // ===== 7. Dashboard =====
  section('7. Librarian dashboard');
  r = await call('GET', '/api/dashboard/stats', LIB);
  expectStatus('Librarian can open the dashboard statistics', r, 200);
  const stats = r.data;
  check('Statistics contain all counters',
    ['total_titles', 'issued_books', 'overdue_books', 'students', 'pending_reservations', 'unpaid_fines']
      .every((k) => typeof stats[k] === 'number'));

  r = await call('GET', '/api/issues?status=active', LIB);
  check('"Issued books" matches the real number of active issues', stats.issued_books === arr(r).length,
    `${stats.issued_books} vs ${arr(r).length}`);
  r = await call('GET', '/api/issues?status=overdue', LIB);
  check('"Overdue books" matches the overdue list', stats.overdue_books === arr(r).length);
  r = await call('GET', '/api/reservations?status=pending', LIB);
  check('"Pending reservations" matches the queue', stats.pending_reservations === arr(r).length);
  r = await call('GET', '/api/fines?status=unpaid', LIB);
  const unpaidSum = arr(r).reduce((s, f) => s + f.fine_amount, 0);
  check('"Unpaid fines" matches the fines list', stats.unpaid_fines === unpaidSum,
    `${stats.unpaid_fines} vs ${unpaidSum}`);
  r = await call('GET', '/api/dashboard/stats', sara.token);
  expectStatus('Student cannot open the dashboard', r, 403);
  r = await call('GET', '/api/dashboard/overdue', null);
  expectStatus('Overdue list without login is blocked', r, 401);

  // ===== 8. Data integrity =====
  section('8. Data integrity (checked directly in the database)');
  const mismatch = db.prepare(
    `SELECT b.book_id FROM books b
     WHERE b.available_copies != b.total_copies -
       (SELECT COUNT(*) FROM issues i WHERE i.book_id = b.book_id AND i.return_date IS NULL)`
  ).all();
  check('Available copies always match the books actually out', mismatch.length === 0, JSON.stringify(mismatch));
  const outOfRange = db.prepare(
    'SELECT book_id FROM books WHERE available_copies < 0 OR available_copies > total_copies'
  ).all();
  check('Available copies are never negative or above the total', outOfRange.length === 0);
  const doubles = db.prepare(
    `SELECT user_id, book_id FROM issues WHERE return_date IS NULL
     GROUP BY user_id, book_id HAVING COUNT(*) > 1`
  ).all();
  check('No student holds the same book twice', doubles.length === 0);
  check('No broken foreign keys', db.pragma('foreign_key_check').length === 0);
}

// ---------- start everything, run, clean up ----------
async function main() {
  console.log('Preparing a temporary database...');
  const db = new Database(DB_FILE);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(ROOT, 'database', 'schema.sql'), 'utf8'));
  const libHash = await bcrypt.hash('librarian123', 4);
  db.prepare(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'librarian')`
  ).run('Test Librarian', 'lib@test.com', libHash);

  console.log(`Starting the server on port ${PORT}...`);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE, JWT_SECRET: 'test-secret-key' }
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The server did not start within 10 seconds')), 10000);
      server.stdout.on('data', (d) => {
        if (String(d).includes('Server running')) { clearTimeout(timer); resolve(); }
      });
      server.stderr.on('data', (d) => { serverErrors += String(d); });
      server.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`The server stopped early (code ${code}). ${serverErrors}`));
      });
    });

    await runTests(db);
  } catch (err) {
    failed++;
    failures.push('Test run crashed');
    console.log(`\n[ERROR] ${err.message}`);
  } finally {
    server.kill();
    db.close();
    await new Promise((r) => setTimeout(r, 500));
    try { fs.unlinkSync(DB_FILE); } catch (e) { /* ignore */ }
  }

  if (serverErrors.trim()) {
    console.log('\n--- Errors printed by the server during the test (these are bugs to fix) ---');
    console.log(serverErrors.trim());
  }

  console.log('\n==============================');
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('==============================');
  process.exit(failed > 0 ? 1 : 0);
}

main();