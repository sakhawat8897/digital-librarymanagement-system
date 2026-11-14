const { Issue, Renewal, createWithId } = require('../models');
const { todayLocal, MAX_RENEWALS } = require('../utils/library');
const { HIDE, toId, withUsersAndBooks } = require('../utils/helpers');
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
exports.requestRenewal = async (req, res) => {
  try {
    const issueId = toId((req.body || {}).issue_id);
    if (issueId === null) return res.status(400).json({ error: 'issue_id is required' });

    await rejectStaleRenewals();

    const issue = await Issue.findOne({ issue_id: issueId }).lean();
    if (!issue) return res.status(404).json({ error: 'Issue record not found' });
    if (issue.user_id !== req.user.user_id) {
      return res.status(403).json({ error: 'You can only renew your own books' });
    }

    const check = await checkRenewable(issue);
    if (!check.ok) return res.status(409).json({ error: check.reason });

    const renewalId = await createWithId(Renewal, 'renewals', 'renewal_id', {
      issue_id: issueId,
      request_date: todayLocal(),
      old_due_date: issue.due_date,
      new_due_date: check.new_due_date
    });

    res.status(201).json({
      message: `Renewal requested. If approved, the new due date will be ${check.new_due_date}`,
      renewal_id: renewalId,
      new_due_date: check.new_due_date
    });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- GET /api/renewals/eligible  (my active books) ----------
exports.getEligible = async (req, res) => {
  try {
    await rejectStaleRenewals();
    const issues = await Issue.find({ user_id: req.user.user_id, return_date: null }).lean();

    const result = [];
    for (const i of issues) {
      const check = await checkRenewable(i);
      result.push({
        issue_id: i.issue_id,
        can_renew: check.ok,
        reason: check.reason,
        new_due_date: check.new_due_date || null,
        renewals_left: Math.max(0, MAX_RENEWALS - i.renewal_count)
      });
    }
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- GET /api/renewals/my ----------
exports.getMyRenewals = async (req, res) => {
  try {
    await rejectStaleRenewals();
    const myIssues = await Issue.find({ user_id: req.user.user_id }).select('issue_id user_id book_id').lean();
    const joined = await withUsersAndBooks(myIssues);
    const byIssue = new Map(joined.map((i) => [i.issue_id, i]));

    const renewals = await Renewal.find({ issue_id: { $in: myIssues.map((i) => i.issue_id) } })
      .sort({ renewal_id: -1 }).select(HIDE).lean();

    res.json(renewals.map((r) => ({
      renewal_id: r.renewal_id, issue_id: r.issue_id, request_date: r.request_date,
      old_due_date: r.old_due_date, new_due_date: r.new_due_date, status: r.status,
      title: byIssue.get(r.issue_id)?.title, author: byIssue.get(r.issue_id)?.author
    })));
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- GET /api/renewals?status=pending|approved|rejected  (librarian) ----------
exports.getRenewals = async (req, res) => {
  try {
    await rejectStaleRenewals();
    const valid = ['pending', 'approved', 'rejected'];
    const filter = valid.includes(req.query.status) ? { status: req.query.status } : {};

    const renewals = await Renewal.find(filter).sort({ renewal_id: -1 }).select(HIDE).lean();
    const issues = await Issue.find({ issue_id: { $in: renewals.map((r) => r.issue_id) } })
      .select(HIDE).lean();
    const joined = await withUsersAndBooks(issues);
    const byIssue = new Map(joined.map((i) => [i.issue_id, i]));

    const result = [];
    for (const r of renewals) {
      const i = byIssue.get(r.issue_id) || {};
      let can_approve = false;
      let blocked_reason = null;
      if (r.status === 'pending' && i.issue_id) {
        const check = await checkRenewable(i, { ignorePending: true });
        can_approve = check.ok;
        blocked_reason = check.reason;
      }
      result.push({
        renewal_id: r.renewal_id, issue_id: r.issue_id, request_date: r.request_date,
        old_due_date: r.old_due_date, new_due_date: r.new_due_date, status: r.status,
        full_name: i.full_name, email: i.email, title: i.title,
        renewal_count: i.renewal_count, can_approve, blocked_reason
      });
    }
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- PUT /api/renewals/:id/approve  (librarian) ----------
exports.approveRenewal = async (req, res) => {
  const id = toId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid renewal id' });

  try {
    const renewal = await Renewal.findOne({ renewal_id: id }).lean();
    if (!renewal) throw new AppError(404, 'Renewal request not found');
    if (renewal.status !== 'pending') throw new AppError(409, 'Only pending requests can be approved');

    const issue = await Issue.findOne({ issue_id: renewal.issue_id }).lean();
    const check = await checkRenewable(issue, { ignorePending: true });
    if (!check.ok) throw new AppError(409, `${check.reason}. You can reject this request`);

    // Approve ONLY if it is still pending (stops a double click)
    const claimed = await Renewal.findOneAndUpdate(
      { renewal_id: id, status: 'pending' },
      { $set: { status: 'approved', old_due_date: issue.due_date, new_due_date: check.new_due_date } }
    );
    if (!claimed) throw new AppError(409, 'Only pending requests can be approved');

    await Issue.updateOne(
      { issue_id: issue.issue_id },
      { $set: { due_date: check.new_due_date }, $inc: { renewal_count: 1 } }
    );

    res.json({ message: `Renewal approved. New due date: ${check.new_due_date}`, new_due_date: check.new_due_date });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- PUT /api/renewals/:id/reject  (librarian) ----------
exports.rejectRenewal = async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid renewal id' });

    const renewal = await Renewal.findOne({ renewal_id: id }).lean();
    if (!renewal) return res.status(404).json({ error: 'Renewal request not found' });
    if (renewal.status !== 'pending') {
      return res.status(409).json({ error: 'Only pending requests can be rejected' });
    }

    await Renewal.updateOne({ renewal_id: id, status: 'pending' }, { $set: { status: 'rejected' } });
    res.json({ message: 'Renewal request rejected' });
  } catch (err) {
    handleError(err, res);
  }
};
