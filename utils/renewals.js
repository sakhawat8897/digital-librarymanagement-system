const { Issue, Renewal, Reservation } = require('../models');
const { todayLocal, addDays, RENEWAL_DAYS, MAX_RENEWALS, BLOCK_ISSUE_IF_UNPAID_FINES } = require('./library');
const { expireOldReservations } = require('./reservations');
const { unpaidFinesOf } = require('./helpers');

// Pending requests for books that were already returned are no longer useful
async function rejectStaleRenewals() {
  const pending = await Renewal.find({ status: 'pending' }).select('issue_id').lean();
  if (pending.length === 0) return;

  const returned = await Issue.find({
    issue_id: { $in: pending.map((p) => p.issue_id) },
    return_date: { $ne: null }
  }).select('issue_id').lean();

  if (returned.length > 0) {
    await Renewal.updateMany(
      { status: 'pending', issue_id: { $in: returned.map((r) => r.issue_id) } },
      { $set: { status: 'rejected' } }
    );
  }
}

// Decides whether an issue can be renewed.
// "issue" needs: issue_id, user_id, book_id, due_date, return_date, renewal_count
async function checkRenewable(issue, { ignorePending = false } = {}) {
  const today = todayLocal();
  await expireOldReservations();

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
    const pending = await Renewal.exists({ issue_id: issue.issue_id, status: 'pending' });
    if (pending) return { ok: false, reason: 'A renewal request is already pending' };
  }

  const reserved = await Reservation.exists({
    book_id: issue.book_id, status: 'pending', user_id: { $ne: issue.user_id }
  });
  if (reserved) {
    return { ok: false, reason: 'Another student has reserved this book' };
  }

  if (BLOCK_ISSUE_IF_UNPAID_FINES) {
    const owed = await unpaidFinesOf(issue.user_id);
    if (owed > 0) {
      return { ok: false, reason: `Unpaid fines of Rs. ${owed} must be cleared first` };
    }
  }

  return { ok: true, reason: null, new_due_date: addDays(issue.due_date, RENEWAL_DAYS) };
}

module.exports = { rejectStaleRenewals, checkRenewable };
