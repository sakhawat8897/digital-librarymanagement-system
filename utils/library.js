// ----- Library rules: change these numbers to match your library -----
const LOAN_DAYS = 14;                       // how many days a book can be kept
const FINE_PER_DAY = 20;                    // Rs. per late day
const BLOCK_ISSUE_IF_UNPAID_FINES = true;   // students with unpaid fines cannot borrow or renew
const RESERVATION_VALID_DAYS = 30;          // a reservation expires after this many days
const RENEWAL_DAYS = 14;                    // days added by one approved renewal
const MAX_RENEWALS = 2;                     // renewals allowed per loan

// ----- Date helpers (dates are text like 2026-11-07) -----
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const todayLocal = () => formatDate(new Date());

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Number(days));
  return formatDate(d);
}

function daysBetween(from, to) {
  const ms = new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00');
  return Math.round(ms / 86400000);
}

function lateDays(dueDate, endDate) {
  return Math.max(0, daysBetween(dueDate, endDate));
}

module.exports = {
  LOAN_DAYS, FINE_PER_DAY, BLOCK_ISSUE_IF_UNPAID_FINES, RESERVATION_VALID_DAYS,
  RENEWAL_DAYS, MAX_RENEWALS,
  todayLocal, addDays, daysBetween, lateDays
};