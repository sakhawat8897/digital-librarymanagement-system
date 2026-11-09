const db = require('../config/database');
const {
  LOAN_DAYS, FINE_PER_DAY, BLOCK_ISSUE_IF_UNPAID_FINES,
  todayLocal, addDays, lateDays
} = require('../utils/library');
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

const ISSUE_SELECT = `
  SELECT i.issue_id, i.user_id, i.book_id, i.issue_date, i.due_date, i.return_date,
         i.fine_amount, i.fine_paid, i.status,
         u.full_name, u.email, b.title, b.author, b.isbn
  FROM issues i
  JOIN users u ON u.user_id = i.user_id
  JOIN books b ON b.book_id = i.book_id`;

// ---------- ISSUE a book ----------
// A transaction means: ALL steps succeed, or NONE of them happen.
const issueTx = db.transaction((userId, bookId) => {
  const student = db.prepare(
    'SELECT user_id, full_name, role, status FROM users WHERE user_id = ?'
  ).get(userId);
  if (!student) throw new AppError(404, 'Student not found');
  if (student.role !== 'member') throw new AppError(400, 'Books can only be issued to student accounts');
  if (student.status !== 'active') throw new AppError(403, 'This student account is suspended');

  // Students with unpaid fines cannot borrow
  if (BLOCK_ISSUE_IF_UNPAID_FINES) {
    const owed = db.prepare(
      `SELECT COALESCE(SUM(fine_amount), 0) AS total FROM issues
       WHERE user_id = ? AND return_date IS NOT NULL AND fine_paid = 0`
    ).get(userId).total;
    if (owed > 0) {
      throw new AppError(403, `This student has unpaid fines of Rs. ${owed}. Collect the fine first`);
    }
  }

  const book = db.prepare('SELECT book_id, title FROM books WHERE book_id = ?').get(bookId);
  if (!book) throw new AppError(404, 'Book not found');

  const alreadyHas = db.prepare(
    'SELECT 1 FROM issues WHERE user_id = ? AND book_id = ? AND return_date IS NULL'
  ).get(userId, bookId);
  if (alreadyHas) {
    throw new AppError(409, 'This student already has this book and has not returned it');
  }

  // Reservations: keep free copies for students waiting in the queue
  expireOldReservations();
  const myReservation = db.prepare(
    `SELECT reservation_id FROM reservations
     WHERE user_id = ? AND book_id = ? AND status = 'pending'`
  ).get(userId, bookId);

  // How many people are in front of this student in the queue
  const ahead = myReservation
    ? db.prepare(`SELECT COUNT(*) AS n FROM reservations
                  WHERE book_id = ? AND status = 'pending' AND reservation_id < ?`)
        .get(bookId, myReservation.reservation_id).n
    : db.prepare(`SELECT COUNT(*) AS n FROM reservations
                  WHERE book_id = ? AND status = 'pending'`).get(bookId).n;

  const freeCopies = db.prepare('SELECT available_copies FROM books WHERE book_id = ?')
    .get(bookId).available_copies;
  if (freeCopies > 0 && freeCopies <= ahead) {
    throw new AppError(409, 'The remaining copies are reserved for students waiting in the queue');
  }

  // Take one copy ONLY if a copy is free. This also stops two librarians
  // from issuing the last copy at the same moment.
  const taken = db.prepare(
    'UPDATE books SET available_copies = available_copies - 1 WHERE book_id = ? AND available_copies > 0'
  ).run(bookId);
  if (taken.changes === 0) throw new AppError(409, 'No copies of this book are available');

  const issueDate = todayLocal();
  const dueDate = addDays(issueDate, LOAN_DAYS);
  const result = db.prepare(
    'INSERT INTO issues (user_id, book_id, issue_date, due_date) VALUES (?, ?, ?, ?)'
  ).run(userId, bookId, issueDate, dueDate);

  // If the student had reserved this book, the reservation is now fulfilled
  if (myReservation) {
    db.prepare(`UPDATE reservations SET status = 'fulfilled' WHERE reservation_id = ?`)
      .run(myReservation.reservation_id);
  }

  return {
    issue_id: Number(result.lastInsertRowid),
    student: student.full_name,
    book: book.title,
    issue_date: issueDate,
    due_date: dueDate
  };
});

exports.issueBook = (req, res) => {
  const { user_id, book_id } = req.body || {};
  const userId = Number(user_id);
  const bookId = Number(book_id);

  if (!Number.isInteger(userId) || !Number.isInteger(bookId)) {
    return res.status(400).json({ error: 'user_id and book_id are required' });
  }

  try {
    const issue = issueTx(userId, bookId);
    res.status(201).json({ message: 'Book issued successfully', ...issue });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- RETURN a book ----------
const returnTx = db.transaction((issueId) => {
  const issue = db.prepare('SELECT * FROM issues WHERE issue_id = ?').get(issueId);
  if (!issue) throw new AppError(404, 'Issue record not found');
  if (issue.return_date) throw new AppError(409, 'This book was already returned');

  const returnDate = todayLocal();
  const late = lateDays(issue.due_date, returnDate);
  const fine = late * FINE_PER_DAY;

  db.prepare(
    `UPDATE issues SET return_date = ?, fine_amount = ?, status = 'returned' WHERE issue_id = ?`
  ).run(returnDate, fine, issueId);

  db.prepare(
    'UPDATE books SET available_copies = available_copies + 1 WHERE book_id = ?'
  ).run(issue.book_id);

  return { return_date: returnDate, late_days: late, fine_amount: fine };
});

exports.returnBook = (req, res) => {
  const issueId = Number(req.params.id);
  if (!Number.isInteger(issueId)) {
    return res.status(400).json({ error: 'Invalid issue id' });
  }

  try {
    const result = returnTx(issueId);
    res.json({ message: 'Book returned successfully', ...result });
  } catch (err) {
    handleError(err, res);
  }
};

// ---------- LIST issues (librarian) ----------
// GET /api/issues?status=active | overdue | returned
exports.getIssues = (req, res) => {
  const today = todayLocal();
  const { status } = req.query;

  let sql = ISSUE_SELECT + ' WHERE 1=1';
  const params = [];

  if (status === 'active') {
    sql += ' AND i.return_date IS NULL';
  } else if (status === 'returned') {
    sql += ' AND i.return_date IS NOT NULL';
  } else if (status === 'overdue') {
    sql += ' AND i.return_date IS NULL AND i.due_date < ?';
    params.push(today);
  }

  sql += ' ORDER BY i.issue_id DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => withFineInfo(r, today)));
};

// ---------- MY issues (any logged-in user) ----------
exports.getMyIssues = (req, res) => {
  const today = todayLocal();
  const rows = db.prepare(
    ISSUE_SELECT + ' WHERE i.user_id = ? ORDER BY i.issue_id DESC'
  ).all(req.user.user_id);
  res.json(rows.map((r) => withFineInfo(r, today)));
};

// ---------- Students list for the issue form (librarian) ----------
exports.getStudents = (req, res) => {
  res.json(db.prepare(
    `SELECT user_id, full_name, email FROM users
     WHERE role = 'member' AND status = 'active' ORDER BY full_name`
  ).all());
};