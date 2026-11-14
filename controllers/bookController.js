const { Book, Issue, Reservation, createWithId } = require('../models');
const { HIDE, toId, escapeRegex } = require('../utils/helpers');
const { expireOldReservations } = require('../utils/reservations');

// Turns empty text into null so the database stores nothing instead of ""
const clean = (v) =>
  v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();

// GET /api/books?search=...&title=...&author=...&category=...
exports.getBooks = async (req, res) => {
  try {
    await expireOldReservations();
    const { search, title, author, category } = req.query;

    const filter = {};
    const and = [];

    if (search) {
      const like = new RegExp(escapeRegex(search), 'i');
      and.push({ $or: [{ title: like }, { author: like }, { category: like }] });
    }
    if (title) and.push({ title: new RegExp(escapeRegex(title), 'i') });
    if (author) and.push({ author: new RegExp(escapeRegex(author), 'i') });
    if (category) and.push({ category: new RegExp('^' + escapeRegex(category) + '$', 'i') });
    if (and.length > 0) filter.$and = and;

    const books = await Book.find(filter).select(HIDE).lean();
    books.sort((a, b) => a.title.localeCompare(b.title));

    // How many students are waiting for each book
    const waiting = await Reservation.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: '$book_id', n: { $sum: 1 } } }
    ]);
    const waitingMap = new Map(waiting.map((w) => [w._id, w.n]));

    res.json(books.map((b) => ({ ...b, pending_reservations: waitingMap.get(b.book_id) || 0 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/books/categories  (used by the filter dropdown)
exports.getCategories = async (req, res) => {
  try {
    const all = await Book.distinct('category');
    res.json(all.filter((c) => c).sort());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/books/:id
exports.getBook = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const book = id === null ? null : await Book.findOne({ book_id: id }).select(HIDE).lean();
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/books   (librarian only)
exports.addBook = async (req, res) => {
  try {
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

    if (await Book.exists({ isbn: clean(isbn) })) {
      return res.status(409).json({ error: 'A book with this ISBN already exists' });
    }

    // A new book starts with ALL copies available
    const bookId = await createWithId(Book, 'books', 'book_id', {
      isbn: clean(isbn),
      title: clean(title),
      author: clean(author),
      publisher: clean(publisher),
      category: clean(category),
      publication_year: year,
      shelf_location: clean(shelf_location),
      total_copies: copies,
      available_copies: copies
    });

    res.status(201).json({ message: 'Book added', book_id: bookId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A book with this ISBN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PUT /api/books/:id   (librarian only)
exports.updateBook = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const book = id === null ? null : await Book.findOne({ book_id: id }).lean();
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
    if (year !== null && year !== undefined) {
      year = Number(year);
      if (!Number.isInteger(year) || year < 1000 || year > 2100) {
        return res.status(400).json({ error: 'Publication year must be between 1000 and 2100' });
      }
    } else {
      year = null;
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

    // Another book with the same ISBN?
    if (isbn !== book.isbn && await Book.exists({ isbn })) {
      return res.status(409).json({ error: 'Another book already uses this ISBN' });
    }

    await Book.updateOne({ book_id: book.book_id }, {
      $set: {
        isbn, title, author,
        publisher: pick('publisher') ?? null,
        category: pick('category') ?? null,
        publication_year: year,
        shelf_location: pick('shelf_location') ?? null,
        total_copies: newTotal,
        available_copies: newTotal - borrowed
      }
    });

    res.json({ message: 'Book updated' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Another book already uses this ISBN' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/books/:id   (librarian only)
exports.deleteBook = async (req, res) => {
  try {
    const id = toId(req.params.id);
    const book = id === null ? null : await Book.findOne({ book_id: id }).lean();
    if (!book) return res.status(404).json({ error: 'Book not found' });

    // A book with borrowing history cannot be deleted (protects the records)
    if (await Issue.exists({ book_id: id })) {
      return res.status(409).json({ error: 'This book has borrowing records and cannot be deleted' });
    }

    await Reservation.deleteMany({ book_id: id });
    await Book.deleteOne({ book_id: id });
    res.json({ message: 'Book deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
