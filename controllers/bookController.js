const db = require('../config/database');
const { expireOldReservations } = require('../utils/reservations');

// Turns empty text into null so the database stores nothing instead of ""
const clean = (v) =>
  v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();

// GET /api/books?search=...&title=...&author=...&category=...
exports.getBooks = (req, res) => {
    expireOldReservations();
  const { search, title, author, category } = req.query;

  let sql = `SELECT books.*,
      (SELECT COUNT(*) FROM reservations
        WHERE reservations.book_id = books.book_id AND reservations.status = 'pending')
        AS pending_reservations
    FROM books WHERE 1=1`;
  const params = [];

  if (search) {
    sql += ' AND (title LIKE ? OR author LIKE ? OR category LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (title) {
    sql += ' AND title LIKE ?';
    params.push(`%${title}%`);
  }
  if (author) {
    sql += ' AND author LIKE ?';
    params.push(`%${author}%`);
  }
  if (category) {
    sql += ' AND category = ? COLLATE NOCASE';
    params.push(category);
  }

  sql += ' ORDER BY title';
  res.json(db.prepare(sql).all(...params));
};

// GET /api/books/categories  (used by the filter dropdown)
exports.getCategories = (req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT category FROM books WHERE category IS NOT NULL ORDER BY category`
  ).all();
  res.json(rows.map((r) => r.category));
};

// GET /api/books/:id
exports.getBook = (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE book_id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  res.json(book);
};

// POST /api/books   (librarian only)
exports.addBook = (req, res) => {
  const { isbn, title, author, publisher, category, publication_year, shelf_location, total_copies } =
    req.body || {};

  if (!clean(isbn) || !clean(title) || !clean(author)) {
    return res.status(400).json({ error: 'ISBN, title and author are required' });
  }

  const copies = clean(total_copies) === null ? 1 : Number(total_copies);
  if (!Number.isInteger(copies) || copies < 0) {
    return res.status(400).json({ error: 'Total copies must be a whole number (0 or more)' });
  }

  let year = null;
  if (clean(publication_year) !== null) {
    year = Number(publication_year);
    if (!Number.isInteger(year) || year < 1000 || year > 2100) {
      return res.status(400).json({ error: 'Publication year must be between 1000 and 2100' });
    }
  }

  try {
    // A new book starts with ALL copies available
    const result = db.prepare(
      `INSERT INTO books
        (isbn, title, author, publisher, category, publication_year, shelf_location, total_copies, available_copies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(clean(isbn), clean(title), clean(author), clean(publisher), clean(category),
          year, clean(shelf_location), copies, copies);

    res.status(201).json({ message: 'Book added', book_id: result.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A book with this ISBN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/books/:id   (librarian only)
exports.updateBook = (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE book_id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const body = req.body || {};

  // Use the new value if sent, otherwise keep the old value
  const pick = (name) => (body[name] !== undefined ? clean(body[name]) : book[name]);

  const isbn = pick('isbn');
  const title = pick('title');
  const author = pick('author');
  if (!isbn || !title || !author) {
    return res.status(400).json({ error: 'ISBN, title and author cannot be empty' });
  }

  let year = body.publication_year !== undefined ? clean(body.publication_year) : book.publication_year;
  if (year !== null) {
    year = Number(year);
    if (!Number.isInteger(year) || year < 1000 || year > 2100) {
      return res.status(400).json({ error: 'Publication year must be between 1000 and 2100' });
    }
  }

  // Copies already borrowed = old total - old available.
  // The new total can never be smaller than that.
  const borrowed = book.total_copies - book.available_copies;
  let newTotal = book.total_copies;
  if (body.total_copies !== undefined) {
    newTotal = Number(body.total_copies);
    if (!Number.isInteger(newTotal) || newTotal < 0) {
      return res.status(400).json({ error: 'Total copies must be a whole number (0 or more)' });
    }
    if (newTotal < borrowed) {
      return res.status(400).json({
        error: `${borrowed} copies are currently issued, so total copies cannot be less than ${borrowed}`
      });
    }
  }
  const newAvailable = newTotal - borrowed;

  try {
    db.prepare(
      `UPDATE books SET isbn = ?, title = ?, author = ?, publisher = ?, category = ?,
         publication_year = ?, shelf_location = ?, total_copies = ?, available_copies = ?
       WHERE book_id = ?`
    ).run(isbn, title, author, pick('publisher'), pick('category'), year,
          pick('shelf_location'), newTotal, newAvailable, book.book_id);

    res.json({ message: 'Book updated' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Another book already uses this ISBN' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/books/:id   (librarian only)
exports.deleteBook = (req, res) => {
  try {
    const result = db.prepare('DELETE FROM books WHERE book_id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ message: 'Book deleted' });
  } catch (err) {
    // issues.book_id uses ON DELETE RESTRICT, so books with history cannot be deleted
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'This book has borrowing records and cannot be deleted' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};