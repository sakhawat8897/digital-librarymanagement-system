const { User, Book } = require('../models');

// Hide MongoDB's internal fields in API answers
const HIDE = '-_id -__v';

// "5" -> 5, "abc" -> null
const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

// Makes user text safe to use inside a search pattern
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Adds the student's name/email and the book's title/author to a list of records
// (records have user_id and book_id). MongoDB has no JOIN, so we look them up.
async function withUsersAndBooks(rows) {
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const bookIds = [...new Set(rows.map((r) => r.book_id))];

  const [users, books] = await Promise.all([
    User.find({ user_id: { $in: userIds } }).select('user_id full_name email').lean(),
    Book.find({ book_id: { $in: bookIds } }).select('book_id title author isbn available_copies').lean()
  ]);

  const userMap = new Map(users.map((u) => [u.user_id, u]));
  const bookMap = new Map(books.map((b) => [b.book_id, b]));

  return rows.map((r) => {
    const u = userMap.get(r.user_id) || {};
    const b = bookMap.get(r.book_id) || {};
    return {
      ...r,
      full_name: u.full_name,
      email: u.email,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      available_copies: b.available_copies
    };
  });
}

// Total of unpaid fines on returned books for one student
async function unpaidFinesOf(userId) {
  const { Issue } = require('../models');
  const rows = await Issue.find({
    user_id: userId, return_date: { $ne: null }, fine_amount: { $gt: 0 }, fine_paid: 0
  }).select('fine_amount').lean();
  return rows.reduce((sum, r) => sum + r.fine_amount, 0);
}

module.exports = { HIDE, toId, escapeRegex, withUsersAndBooks, unpaidFinesOf };
