const { User, Book, Issue, Reservation, createWithId } = require('../models');
const { todayLocal, addDays, RESERVATION_VALID_DAYS } = require('../utils/library');
const { HIDE, toId, withUsersAndBooks } = require('../utils/helpers');
const { expireOldReservations } = require('../utils/reservations');

// Adds names, queue position and "copy ready" to a list of reservations.
// queue_position = 1 + the number of pending reservations made before this one.
async function decorate(rows) {
  const pending = await Reservation.find({ status: 'pending' })
    .select('reservation_id book_id').sort({ reservation_id: 1 }).lean();

  const countPerBook = {};
  const position = new Map();
  for (const p of pending) {
    countPerBook[p.book_id] = (countPerBook[p.book_id] || 0) + 1;
    position.set(p.reservation_id, countPerBook[p.book_id]);
  }

  const joined = await withUsersAndBooks(rows);
  return joined.map((r) => {
    const queue_position = r.status === 'pending' ? position.get(r.reservation_id) : null;
    return {
      ...r,
      queue_position,
      // A copy is "ready" when enough copies are free for this person's place in the queue
      copy_ready: r.status === 'pending' && r.available_copies >= queue_position
    };
  });
}

// POST /api/reservations   (students only)
exports.reserveBook = async (req, res) => {
  try {
    const bookId = toId((req.body || {}).book_id);
    if (bookId === null) return res.status(400).json({ error: 'book_id is required' });

    await expireOldReservations();
    const userId = req.user.user_id;

    const account = await User.findOne({ user_id: userId }).select('status').lean();
    if (!account || account.status !== 'active') {
      return res.status(403).json({ error: 'Your account is suspended' });
    }

    const book = await Book.findOne({ book_id: bookId }).lean();
    if (!book) return res.status(404).json({ error: 'Book not found' });

    if (await Issue.exists({ user_id: userId, book_id: bookId, return_date: null })) {
      return res.status(409).json({ error: 'You already have this book' });
    }
    if (await Reservation.exists({ user_id: userId, book_id: bookId, status: 'pending' })) {
      return res.status(409).json({ error: 'You already reserved this book' });
    }

    const pending = await Reservation.countDocuments({ book_id: bookId, status: 'pending' });
    if (book.available_copies > pending) {
      return res.status(409).json({ error: 'Copies are available now. Please ask the librarian to issue the book' });
    }

    const today = todayLocal();
    const reservationId = await createWithId(Reservation, 'reservations', 'reservation_id', {
      user_id: userId,
      book_id: bookId,
      reservation_date: today,
      expiry_date: addDays(today, RESERVATION_VALID_DAYS)
    });

    res.status(201).json({
      message: `"${book.title}" reserved. Your place in the queue: ${pending + 1}`,
      reservation_id: reservationId,
      queue_position: pending + 1
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/reservations/my   (any logged-in user)
exports.getMyReservations = async (req, res) => {
  try {
    await expireOldReservations();
    const rows = await Reservation.find({ user_id: req.user.user_id })
      .sort({ reservation_id: -1 }).select(HIDE).lean();
    res.json(await decorate(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/reservations?status=pending|fulfilled|cancelled|expired   (librarian)
exports.getReservations = async (req, res) => {
  try {
    await expireOldReservations();
    const valid = ['pending', 'fulfilled', 'cancelled', 'expired'];
    const filter = valid.includes(req.query.status) ? { status: req.query.status } : {};

    const rows = await Reservation.find(filter)
      .sort({ book_id: 1, reservation_id: 1 }).select(HIDE).lean();
    res.json(await decorate(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/reservations/:id/cancel
exports.cancelReservation = async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid reservation id' });

    const row = await Reservation.findOne({ reservation_id: id }).lean();
    if (!row) return res.status(404).json({ error: 'Reservation not found' });

    const isStaff = req.user.role === 'librarian' || req.user.role === 'admin';
    if (!isStaff && row.user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'You can only cancel your own reservations' });
    }
    if (row.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending reservations can be cancelled' });
    }

    await Reservation.updateOne({ reservation_id: id, status: 'pending' }, { $set: { status: 'cancelled' } });
    res.json({ message: 'Reservation cancelled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
