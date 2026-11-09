const express = require('express');
const router = express.Router();
const { issueBook, returnBook, getIssues, getMyIssues, getStudents } =
  require('../controllers/issueController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

router.get('/my', verifyToken, getMyIssues);          // any logged-in user
router.get('/students', librarianOnly, getStudents);
router.get('/', librarianOnly, getIssues);
router.post('/', librarianOnly, issueBook);
router.put('/:id/return', librarianOnly, returnBook);

module.exports = router;