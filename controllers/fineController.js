const { Issue } = require('../models');
const { todayLocal, lateDays, FINE_PER_DAY } = require('../utils/library');
const { HIDE, toId, withUsersAndBooks } = require('../utils/helpers');

// GET /api/fines?status=unpaid|paid
// Final fines: books that were returned late
exports.getFines = async (req, res) => {
  try {
    const paid = req.query.status === 'paid' ? 1 : 0;

    const rows = await Issue.find({
      return_date: { $ne: null }, fine_amount: { $gt: 0 }, fine_paid: paid
    }).select(HIDE).lean();
    rows.sort((a, b) => (a.return_date < b.return_date ? 1 : a.return_date > b.return_date ? -1 : b.issue_id - a.issue_id));

    const joined = await withUsersAndBooks(rows);
    res.json(joined.map((r) => ({ ...r, late_days: lateDays(r.due_date, r.return_date) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/fines/summary
exports.getSummary = async (req, res) => {
  try {
    const today = todayLocal();

    const finals = await Issue.find({ return_date: { $ne: null }, fine_amount: { $gt: 0 } })
      .select('fine_amount fine_paid').lean();
    const unpaid_total = finals.filter((f) => !f.fine_paid).reduce((s, f) => s + f.fine_amount, 0);
    const paid_total = finals.filter((f) => f.fine_paid).reduce((s, f) => s + f.fine_amount, 0);

    // Books still out and late: the fine is still growing
    const overdue = await Issue.find({ return_date: null, due_date: { $lt: today } })
      .select('due_date').lean();
    const accruing = overdue.reduce((sum, r) => sum + lateDays(r.due_date, today) * FINE_PER_DAY, 0);

    res.json({ unpaid_total, paid_total, accruing_total: accruing, overdue_count: overdue.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/fines/:id/pay
exports.payFine = async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid issue id' });

    const issue = await Issue.findOne({ issue_id: id }).lean();
    if (!issue) return res.status(404).json({ error: 'Issue record not found' });
    if (!issue.return_date) {
      return res.status(400).json({ error: 'Record the return first. The fine is final only after the book is returned' });
    }
    if (issue.fine_amount <= 0) return res.status(400).json({ error: 'This record has no fine' });
    if (issue.fine_paid) return res.status(409).json({ error: 'This fine is already paid' });

    // Only mark it if it is still unpaid (stops a double click)
    const done = await Issue.findOneAndUpdate({ issue_id: id, fine_paid: 0 }, { $set: { fine_paid: 1 } });
    if (!done) return res.status(409).json({ error: 'This fine is already paid' });

    res.json({ message: `Fine of Rs. ${issue.fine_amount} marked as paid`, fine_amount: issue.fine_amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
