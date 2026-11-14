const { Reservation } = require('../models');
const { todayLocal } = require('./library');

// Marks old pending reservations as expired
async function expireOldReservations() {
  await Reservation.updateMany(
    { status: 'pending', expiry_date: { $lt: todayLocal() } },
    { $set: { status: 'expired' } }
  );
}

module.exports = { expireOldReservations };
