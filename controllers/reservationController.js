const db = require('../config/database');
const { todayLocal, addDays, RESERVATION_VALID_DAYS } = require('../utils/library');
const { expireOldReservations } = require('../utils/reservations');

// queue_position = 1 + number of pending reservations made before this one
const LIST_SELECT = `
  SELECT r.reservation_id, r.user_id, r.book_id, r.reservation_date, r.expiry_date, r.status,
         u.full_name, u.email, b.title, b.author, b.available_copies,
         (SELECT COUNT(*) FROM reservations r2
           WHERE r2.book_id = r.book_id AND r2.status = 'pending'
             AND r2.reservation_id < r.reservation_id) + 1 AS queue_position
  FROM reservations r
  JOIN users u ON u.user_id = r.user_id
  JOIN books b ON b.book_id = r.book_id`;

// A copy is "ready" when enough copies are free for this person's place in the queue
const addReady = (rows) => rows.map((r) => ({
  ...r,
  copy_ready: r.status === 'pending' && r.available_copies >= r.queue_position
}));

// POST /api/reservations   (students only)
exports.reserveBook = (req, res) => {
  const bookId = Number((req.body || {}).book_id);
  if (!Number.isInteger(bookId)) return res.status(400).json({ error: 'book_id is required' });

  expireOldReservations();
  const userId = req.user.user_id;

  const account = db.prepare('SELECT status FROM users WHERE user_id = ?').get(userId);
  if (!account || account.status !== 'active') {
    return res.status(403).json({ error: 'Your account is suspended' });
  }

  const book = db.prepare('SELECT book_id, title, available_copies FROM books WHERE book_id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const hasIt = db.prepare(
    'SELECT 1 FROM issues WHERE user_id = ? AND book_id = ? AND return_date IS NULL'
  ).get(userId, bookId);
  if (hasIt) return res.status(409).json({ error: 'You already have this book' });

  const duplicate = db.prepare(
    `SELECT 1 FROM reservations WHERE user_id = ? AND book_id = ? AND status = 'pending'`
  ).get(userId, bookId);
  if (duplicate) return res.status(409).json({ error: 'You already reserved this book' });

  const pending = db.prepare(
    `SELECT COUNT(*) AS n FROM reservations WHERE book_id = ? AND status = 'pending'`
  ).get(bookId).n;

  if (book.available_copies > pending) {
    return res.status(409).json({ error: 'Copies are available now. Please ask the librarian to issue the book' });
  }

  const today = todayLocal();
  const result = db.prepare(
    'INSERT INTO reservations (user_id, book_id, reservation_date, expiry_date) VALUES (?, ?, ?, ?)'
  ).run(userId, bookId, today, addDays(today, RESERVATION_VALID_DAYS));

  res.status(201).json({
    message: `"${book.title}" reserved. Your place in the queue: ${pending + 1}`,
    reservation_id: Number(result.lastInsertRowid),
    queue_position: pending + 1
  });
};

// GET /api/reservations/my   (any logged-in user)
exports.getMyReservations = (req, res) => {
  expireOldReservations();
  const rows = db.prepare(LIST_SELECT + ' WHERE r.user_id = ? ORDER BY r.reservation_id DESC')
    .all(req.user.user_id);
  res.json(addReady(rows));
};

// GET /api/reservations?status=pending|fulfilled|cancelled|expired   (librarian)
exports.getReservations = (req, res) => {
  expireOldReservations();
  const valid = ['pending', 'fulfilled', 'cancelled', 'expired'];
  const { status } = req.query;

  let sql = LIST_SELECT;
  const params = [];
  if (valid.includes(status)) {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.book_id, r.reservation_id';
  res.json(addReady(db.prepare(sql).all(...params)));
};

// PUT /api/reservations/:id/cancel
exports.cancelReservation = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid reservation id' });

  const row = db.prepare('SELECT * FROM reservations WHERE reservation_id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Reservation not found' });

  const isStaff = req.user.role === 'librarian' || req.user.role === 'admin';
  if (!isStaff && row.user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'You can only cancel your own reservations' });
  }
  if (row.status !== 'pending') {
    return res.status(409).json({ error: 'Only pending reservations can be cancelled' });
  }

  db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE reservation_id = ?`).run(id);
  res.json({ message: 'Reservation cancelled' });
};