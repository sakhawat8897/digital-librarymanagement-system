const { User, Book, Issue, Reservation } = require('../models');
const { todayLocal, lateDays, FINE_PER_DAY } = require('../utils/library');
const { expireOldReservations } = require('../utils/reservations');

// GET /api/dashboard/stats
exports.getStats = async (req, res) => {
  try {
    const today = todayLocal();
    await expireOldReservations();

    const totals = await Book.aggregate([
      { $group: {
          _id: null,
          titles: { $sum: 1 },
          copies: { $sum: '$total_copies' },
          available: { $sum: '$available_copies' }
      } }
    ]);
    const t = totals[0] || { titles: 0, copies: 0, available: 0 };

    const finals = await Issue.find({
      return_date: { $ne: null }, fine_amount: { $gt: 0 }, fine_paid: 0
    }).select('fine_amount').lean();

    res.json({
      total_titles: t.titles,
      total_copies: t.copies,
      available_copies: t.available,
      issued_books: await Issue.countDocuments({ return_date: null }),
      overdue_books: await Issue.countDocuments({ return_date: null, due_date: { $lt: today } }),
      students: await User.countDocuments({ role: 'member' }),
      pending_reservations: await Reservation.countDocuments({ status: 'pending' }),
      unpaid_fines: finals.reduce((sum, f) => sum + f.fine_amount, 0)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/dashboard/overdue
exports.getOverdue = async (req, res) => {
  try {
    const today = todayLocal();

    const rows = await Issue.find({ return_date: null, due_date: { $lt: today } })
      .select('-_id issue_id user_id book_id issue_date due_date').sort({ due_date: 1 }).lean();

    const users = await User.find({ user_id: { $in: rows.map((r) => r.user_id) } })
      .select('user_id full_name email').lean();
    const books = await Book.find({ book_id: { $in: rows.map((r) => r.book_id) } })
      .select('book_id title').lean();
    const userMap = new Map(users.map((u) => [u.user_id, u]));
    const bookMap = new Map(books.map((b) => [b.book_id, b]));

    res.json(rows.map((r) => {
      const late = lateDays(r.due_date, today);
      return {
        issue_id: r.issue_id,
        issue_date: r.issue_date,
        due_date: r.due_date,
        full_name: userMap.get(r.user_id)?.full_name,
        email: userMap.get(r.user_id)?.email,
        title: bookMap.get(r.book_id)?.title,
        late_days: late,
        fine_amount: late * FINE_PER_DAY
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
