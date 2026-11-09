const db = require('../config/database');
const { todayLocal } = require('./library');

// Marks old pending reservations as expired
function expireOldReservations() {
  db.prepare(
    `UPDATE reservations SET status = 'expired'
     WHERE status = 'pending' AND expiry_date IS NOT NULL AND expiry_date < ?`
  ).run(todayLocal());
}

module.exports = { expireOldReservations };