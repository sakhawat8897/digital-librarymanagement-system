const db = require('../config/database');
const {
  todayLocal, addDays, RENEWAL_DAYS, MAX_RENEWALS, BLOCK_ISSUE_IF_UNPAID_FINES
} = require('./library');
const { expireOldReservations } = require('./reservations');

// Pending requests for books that were already returned are no longer useful
function rejectStaleRenewals() {
  db.prepare(
    `UPDATE renewals SET status = 'rejected'
     WHERE status = 'pending'
       AND issue_id IN (SELECT issue_id FROM issues WHERE return_date IS NOT NULL)`
  ).run();
}

// Decides whether an issue can be renewed.
// "issue" needs: issue_id, user_id, book_id, due_date, return_date, renewal_count
function checkRenewable(issue, { ignorePending = false } = {}) {
  const today = todayLocal();
  expireOldReservations();

  if (issue.return_date) {
    return { ok: false, reason: 'This book was already returned' };
  }
  if (issue.due_date < today) {
    return { ok: false, reason: 'This book is overdue. Return it first' };
  }
  if (issue.renewal_count >= MAX_RENEWALS) {
    return { ok: false, reason: `Maximum of ${MAX_RENEWALS} renewals reached` };
  }

  if (!ignorePending) {
    const pending = db.prepare(
      `SELECT 1 FROM renewals WHERE issue_id = ? AND status = 'pending'`
    ).get(issue.issue_id);
    if (pending) return { ok: false, reason: 'A renewal request is already pending' };
  }

  const reserved = db.prepare(
    `SELECT 1 FROM reservations
     WHERE book_id = ? AND status = 'pending' AND user_id != ?`
  ).get(issue.book_id, issue.user_id);
  if (reserved) {
    return { ok: false, reason: 'Another student has reserved this book' };
  }

  if (BLOCK_ISSUE_IF_UNPAID_FINES) {
    const owed = db.prepare(
      `SELECT COALESCE(SUM(fine_amount), 0) AS total FROM issues
       WHERE user_id = ? AND return_date IS NOT NULL AND fine_paid = 0`
    ).get(issue.user_id).total;
    if (owed > 0) {
      return { ok: false, reason: `Unpaid fines of Rs. ${owed} must be cleared first` };
    }
  }

  return { ok: true, reason: null, new_due_date: addDays(issue.due_date, RENEWAL_DAYS) };
}

module.exports = { rejectStaleRenewals, checkRenewable };