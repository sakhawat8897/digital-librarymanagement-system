const db = require('../config/database');
const { todayLocal, lateDays, FINE_PER_DAY } = require('../utils/library');
const { expireOldReservations } = require('../utils/reservations');

// GET /api/dashboard/stats
exports.getStats = (req, res) => {
  const today = todayLocal();
  expireOldReservations();

  const one = (sql, ...params) => db.prepare(sql).get(...params);

  const books = one(
    `SELECT COUNT(*) AS titles,
            COALESCE(SUM(total_copies), 0) AS copies,
            COALESCE(SUM(available_copies), 0) AS available
     FROM books`
  );

  res.json({
    total_titles: books.titles,
    total_copies: books.copies,
    available_copies: books.available,
    issued_books: one('SELECT COUNT(*) AS n FROM issues WHERE return_date IS NULL').n,
    overdue_books: one(
      'SELECT COUNT(*) AS n FROM issues WHERE return_date IS NULL AND due_date < ?', today
    ).n,
    students: one(`SELECT COUNT(*) AS n FROM users WHERE role = 'member'`).n,
    pending_reservations: one(
      `SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending'`
    ).n,
    unpaid_fines: one(
      `SELECT COALESCE(SUM(fine_amount), 0) AS total FROM issues
       WHERE return_date IS NOT NULL AND fine_amount > 0 AND fine_paid = 0`
    ).total
  });
};

// GET /api/dashboard/overdue
exports.getOverdue = (req, res) => {
  const today = todayLocal();

  const rows = db.prepare(
    `SELECT i.issue_id, i.issue_date, i.due_date,
            u.full_name, u.email, b.title
     FROM issues i
     JOIN users u ON u.user_id = i.user_id
     JOIN books b ON b.book_id = i.book_id
     WHERE i.return_date IS NULL AND i.due_date < ?
     ORDER BY i.due_date ASC`
  ).all(today);

  res.json(rows.map((r) => {
    const late = lateDays(r.due_date, today);
    return { ...r, late_days: late, fine_amount: late * FINE_PER_DAY };
  }));
};