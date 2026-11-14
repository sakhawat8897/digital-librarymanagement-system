const { User, Book, Issue, Reservation, createWithId } = require('../models');
const {
  LOAN_DAYS, FINE_PER_DAY, BLOCK_ISSUE_IF_UNPAID_FINES,
  todayLocal, addDays, lateDays
} = require('../utils/library');
const { HIDE, withUsersAndBooks, unpaidFinesOf } = require('../utils/helpers');
const { expireOldReservations } = require('../utils/reservations');

// An error that carries an HTTP status code (400, 404, 409, ...)
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function handleError(err, res) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// Adds late days and the current fine to an issue row
function withFineInfo(row, today) {
  const late = lateDays(row.due_date, row.return_date || today);
  return {
    ...row,
    late_days: late,
    current_fine: row.return_date ? row.fine_amount : late * FINE_PER_DAY,
    is_overdue: !row.return_date && late > 0
  };
}

async function listIssues(filter, today) {
  const rows = await Issue.find(filter).sort({ issue_id: -1 }).select(HIDE).lean();
  const joined = await withUsersAndBooks(rows);
  return joined.map((r) => withFineInfo(r, today));
}

// ---------- ISSUE a book ----------
// MongoDB on a normal computer has no multi-step transactions, so each step
// is made safe on its own: the copy is taken with ONE atomic update, and it
// is put back if saving the issue record fails.
async function issueTx(userId, bookId) {
  const student = await User.findOne({ user_id: userId }).lean();
  if (!student) throw new AppError(404, 'Student not found');
  if (student.role !== 'member') throw new AppError(400, 'Books can only be issued to student accounts');
  if (student.status !== 'active') throw new AppError(403, 'This student account is suspended');

  // Students with unpaid fines cannot borrow
  if (BLOCK_ISSUE_IF_UNPAID_FINES) {
    const owed = await unpaidFinesOf(userId);
    if (owed > 0) {
      throw new AppError(403, `This student has unpaid fines of Rs. ${owed}. Collect the fine first`);
    }
  }

  const book = await Book.findOne({ book_id: bookId }).lean();
  if (!book) throw new AppError(404, 'Book not found');

  const alreadyHas = await Issue.exists({ user_id: userId, book_id: bookId, return_date: null });
  if (alreadyHas) {
    throw new AppError(409, 'This student already has this book and has not returned it');
  }

  // Reservations: keep free copies for students waiting in the queue
  await expireOldReservations();
  const myReservation = await Reservation
    .findOne({ user_id: userId, book_id: bookId, status: 'pending' }).lean();

  // How many people are in front of this student in the queue
  const ahead = myReservation
    ? await Reservation.countDocuments({
        book_id: bookId, status: 'pending', reservation_id: { $lt: myReservation.reservation_id }
      })
    : await Reservation.countDocuments({ book_id: bookId, status: 'pending' });

  const fresh = await Book.findOne({ book_id: bookId }).select('available_copies').lean();
  if (fresh.available_copies > 0 && fresh.available_copies <= ahead) {
    throw new AppError(409, 'The remaining copies are reserved for students waiting in the queue');
  }

  // Take one copy ONLY if a copy is free. This also stops two librarians
  // from issuing the last copy at the same moment.
  const taken = await Book.findOneAndUpdate(
    { book_id: bookId, available_copies: { $gt: 0 } },
    { $inc: { available_copies: -1 } }
  );
  if (!taken) throw new AppError(409, 'No copies of this book are available');

  const issueDate = todayLocal();
  const dueDate = addDays(issueDate, LOAN_DAYS);
  let issueId;
  try {
    issueId = await createWithId(Issue, 'issues', 'issue_id', {
      user_id: userId, book_id: bookId, issue_date: issueDate, due_date: dueDate
    });
  } catch (err) {
    await Book.updateOne({ book_id: bookId }, { $inc: { available_copies: 1 } }); // put the copy back
    throw err;
  }

  // If the student had reserved this book, the reservation is now fulfilled
  if (myReservation) {
    await Reservation.updateOne(
      { reservation_id: myReservation.reservation_id }, { $set: { status: 'fulfilled' } }
    );
  }

  return {
    issue_id: issueId,
    student: student.full_name,
    book: book.title,
    issue_date: issueDate,
    due_date: dueDate
  };
}

exports.issueBook = async (req, res) => {
  const { user_id, book_id } = req.body || {};
  const userId = Number(user_id);
  const bookId = Number(book_id);

  if (!Number.isInteger(userId) || !Number.isInteger(bookId)) {
    return res.status(400).json({ error: 'user_id and book_id are required' });
  }

  try {
    const issue = await issueTx(userId, bookId);
    res.status(201).json({ message: 'Book issued successfully', ...issue });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- RETURN a book ----------
async function returnTx(issueId) {
  const issue = await Issue.findOne({ issue_id: issueId }).lean();
  if (!issue) throw new AppError(404, 'Issue record not found');
  if (issue.return_date) throw new AppError(409, 'This book was already returned');

  const returnDate = todayLocal();
  const late = lateDays(issue.due_date, returnDate);
  const fine = late * FINE_PER_DAY;

  // Mark it returned ONLY if it is still out. This stops a double return
  // (two clicks) from adding the copy back twice.
  const claimed = await Issue.findOneAndUpdate(
    { issue_id: issueId, return_date: null },
    { $set: { return_date: returnDate, fine_amount: fine, status: 'returned' } }
  );
  if (!claimed) throw new AppError(409, 'This book was already returned');

  await Book.updateOne({ book_id: issue.book_id }, { $inc: { available_copies: 1 } });

  return { return_date: returnDate, late_days: late, fine_amount: fine };
}

exports.returnBook = async (req, res) => {
  const issueId = Number(req.params.id);
  if (!Number.isInteger(issueId)) {
    return res.status(400).json({ error: 'Invalid issue id' });
  }

  try {
    const result = await returnTx(issueId);
    res.json({ message: 'Book returned successfully', ...result });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- LIST issues (librarian) ----------
// GET /api/issues?status=active | overdue | returned
exports.getIssues = async (req, res) => {
  try {
    const today = todayLocal();
    const { status } = req.query;

    let filter = {};
    if (status === 'active') filter = { return_date: null };
    else if (status === 'returned') filter = { return_date: { $ne: null } };
    else if (status === 'overdue') filter = { return_date: null, due_date: { $lt: today } };

    res.json(await listIssues(filter, today));
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- MY issues (any logged-in user) ----------
exports.getMyIssues = async (req, res) => {
  try {
    res.json(await listIssues({ user_id: req.user.user_id }, todayLocal()));
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- Students list for the issue form (librarian) ----------
exports.getStudents = async (req, res) => {
  try {
    const students = await User.find({ role: 'member', status: 'active' })
      .select('user_id full_name email -_id').lean();
    students.sort((a, b) => a.full_name.localeCompare(b.full_name));
    res.json(students);
  } catch (err) {
    handleError(err, res);
  }
};
