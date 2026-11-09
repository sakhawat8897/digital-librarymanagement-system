const db = require('../config/database');
const { todayLocal, MAX_RENEWALS } = require('../utils/library');
const { rejectStaleRenewals, checkRenewable } = require('../utils/renewals');

class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function handleError(err, res) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// ---------- POST /api/renewals  (students) ----------
exports.requestRenewal = (req, res) => {
  const issueId = Number((req.body || {}).issue_id);
  if (!Number.isInteger(issueId)) return res.status(400).json({ error: 'issue_id is required' });

  rejectStaleRenewals();

  const issue = db.prepare('SELECT * FROM issues WHERE issue_id = ?').get(issueId);
  if (!issue) return res.status(404).json({ error: 'Issue record not found' });
  if (issue.user_id !== req.user.user_id) {
    return res.status(403).json({ error: 'You can only renew your own books' });
  }

  const check = checkRenewable(issue);
  if (!check.ok) return res.status(409).json({ error: check.reason });

  const result = db.prepare(
    `INSERT INTO renewals (issue_id, request_date, old_due_date, new_due_date)
     VALUES (?, ?, ?, ?)`
  ).run(issueId, todayLocal(), issue.due_date, check.new_due_date);

  res.status(201).json({
    message: `Renewal requested. If approved, the new due date will be ${check.new_due_date}`,
    renewal_id: Number(result.lastInsertRowid),
    new_due_date: check.new_due_date
  });
};

// ---------- GET /api/renewals/eligible  (my active books) ----------
exports.getEligible = (req, res) => {
  rejectStaleRenewals();
  const issues = db.prepare(
    'SELECT * FROM issues WHERE user_id = ? AND return_date IS NULL'
  ).all(req.user.user_id);

  res.json(issues.map((i) => {
    const check = checkRenewable(i);
    return {
      issue_id: i.issue_id,
      can_renew: check.ok,
      reason: check.reason,
      new_due_date: check.new_due_date || null,
      renewals_left: Math.max(0, MAX_RENEWALS - i.renewal_count)
    };
  }));
};

// ---------- GET /api/renewals/my ----------
exports.getMyRenewals = (req, res) => {
  rejectStaleRenewals();
  res.json(db.prepare(
    `SELECT r.renewal_id, r.issue_id, r.request_date, r.old_due_date, r.new_due_date, r.status,
            b.title, b.author
     FROM renewals r
     JOIN issues i ON i.issue_id = r.issue_id
     JOIN books b ON b.book_id = i.book_id
     WHERE i.user_id = ?
     ORDER BY r.renewal_id DESC`
  ).all(req.user.user_id));
};

// ---------- GET /api/renewals?status=pending|approved|rejected  (librarian) ----------
exports.getRenewals = (req, res) => {
  rejectStaleRenewals();
  const valid = ['pending', 'approved', 'rejected'];
  const { status } = req.query;

  let sql = `
    SELECT r.renewal_id, r.issue_id, r.request_date, r.old_due_date, r.new_due_date, r.status,
           u.full_name, u.email, b.title,
           i.user_id, i.book_id, i.due_date, i.return_date, i.renewal_count
    FROM renewals r
    JOIN issues i ON i.issue_id = r.issue_id
    JOIN users u ON u.user_id = i.user_id
    JOIN books b ON b.book_id = i.book_id`;
  const params = [];
  if (valid.includes(status)) {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.renewal_id DESC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => {
    let can_approve = false;
    let blocked_reason = null;
    if (r.status === 'pending') {
      const check = checkRenewable(r, { ignorePending: true });
      can_approve = check.ok;
      blocked_reason = check.reason;
    }
    return {
      renewal_id: r.renewal_id, issue_id: r.issue_id, request_date: r.request_date,
      old_due_date: r.old_due_date, new_due_date: r.new_due_date, status: r.status,
      full_name: r.full_name, email: r.email, title: r.title,
      renewal_count: r.renewal_count, can_approve, blocked_reason
    };
  }));
};

// ---------- PUT /api/renewals/:id/approve  (librarian) ----------
const approveTx = db.transaction((id) => {
  const renewal = db.prepare('SELECT * FROM renewals WHERE renewal_id = ?').get(id);
  if (!renewal) throw new AppError(404, 'Renewal request not found');
  if (renewal.status !== 'pending') throw new AppError(409, 'Only pending requests can be approved');

  const issue = db.prepare('SELECT * FROM issues WHERE issue_id = ?').get(renewal.issue_id);
  const check = checkRenewable(issue, { ignorePending: true });
  if (!check.ok) throw new AppError(409, `${check.reason}. You can reject this request`);

  db.prepare(
    `UPDATE renewals SET status = 'approved', old_due_date = ?, new_due_date = ?
     WHERE renewal_id = ?`
  ).run(issue.due_date, check.new_due_date, id);

  db.prepare(
    'UPDATE issues SET due_date = ?, renewal_count = renewal_count + 1 WHERE issue_id = ?'
  ).run(check.new_due_date, issue.issue_id);

  return check.new_due_date;
});

exports.approveRenewal = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid renewal id' });

  try {
    const newDue = approveTx(id);
    res.json({ message: `Renewal approved. New due date: ${newDue}`, new_due_date: newDue });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- PUT /api/renewals/:id/reject  (librarian) ----------
exports.rejectRenewal = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid renewal id' });

  const renewal = db.prepare('SELECT * FROM renewals WHERE renewal_id = ?').get(id);
  if (!renewal) return res.status(404).json({ error: 'Renewal request not found' });
  if (renewal.status !== 'pending') {
    return res.status(409).json({ error: 'Only pending requests can be rejected' });
  }

  db.prepare(`UPDATE renewals SET status = 'rejected' WHERE renewal_id = ?`).run(id);
  res.json({ message: 'Renewal request rejected' });
};