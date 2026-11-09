const db = require('../config/database');
const { todayLocal, lateDays, FINE_PER_DAY } = require('../utils/library');

// GET /api/fines?status=unpaid|paid
// Final fines: books that were returned late
exports.getFines = (req, res) => {
  const paid = req.query.status === 'paid' ? 1 : 0;

  const rows = db.prepare(
    `SELECT i.issue_id, i.issue_date, i.due_date, i.return_date, i.fine_amount, i.fine_paid,
            u.full_name, u.email, b.title
     FROM issues i
     JOIN users u ON u.user_id = i.user_id
     JOIN books b ON b.book_id = i.book_id
     WHERE i.return_date IS NOT NULL AND i.fine_amount > 0 AND i.fine_paid = ?
     ORDER BY i.return_date DESC`
  ).all(paid);

  res.json(rows.map((r) => ({ ...r, late_days: lateDays(r.due_date, r.return_date) })));
};

// GET /api/fines/summary
exports.getSummary = (req, res) => {
  const today = todayLocal();

  const sums = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN fine_paid = 0 THEN fine_amount END), 0) AS unpaid_total,
       COALESCE(SUM(CASE WHEN fine_paid = 1 THEN fine_amount END), 0) AS paid_total
     FROM issues
     WHERE return_date IS NOT NULL AND fine_amount > 0`
  ).get();

  // Books still out and late: the fine is still growing
  const overdue = db.prepare(
    'SELECT due_date FROM issues WHERE return_date IS NULL AND due_date < ?'
  ).all(today);
  const accruing = overdue.reduce((sum, r) => sum + lateDays(r.due_date, today) * FINE_PER_DAY, 0);

  res.json({
    unpaid_total: sums.unpaid_total,
    paid_total: sums.paid_total,
    accruing_total: accruing,
    overdue_count: overdue.length
  });
};

// PUT /api/fines/:id/pay
exports.payFine = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid issue id' });

  const issue = db.prepare('SELECT * FROM issues WHERE issue_id = ?').get(id);
  if (!issue) return res.status(404).json({ error: 'Issue record not found' });
  if (!issue.return_date) {
    return res.status(400).json({ error: 'Record the return first. The fine is final only after the book is returned' });
  }
  if (issue.fine_amount <= 0) return res.status(400).json({ error: 'This record has no fine' });
  if (issue.fine_paid) return res.status(409).json({ error: 'This fine is already paid' });

  db.prepare('UPDATE issues SET fine_paid = 1 WHERE issue_id = ?').run(id);
  res.json({ message: `Fine of Rs. ${issue.fine_amount} marked as paid`, fine_amount: issue.fine_amount });
};