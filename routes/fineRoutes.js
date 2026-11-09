const express = require('express');
const router = express.Router();
const { getFines, getSummary, payFine } = require('../controllers/fineController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

router.get('/summary', librarianOnly, getSummary);   // before '/:id/pay'
router.get('/', librarianOnly, getFines);
router.put('/:id/pay', librarianOnly, payFine);

module.exports = router;