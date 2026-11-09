const express = require('express');
const router = express.Router();
const { getBooks, getCategories, getBook, addBook, updateBook, deleteBook } =
  require('../controllers/bookController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

// Everyone can view and search
router.get('/', getBooks);
router.get('/categories', getCategories);   // must come BEFORE '/:id'
router.get('/:id', getBook);

// Only librarians can change the catalog
router.post('/', librarianOnly, addBook);
router.put('/:id', librarianOnly, updateBook);
router.delete('/:id', librarianOnly, deleteBook);

module.exports = router;