const express = require('express');
const router = express.Router();
const { getStats, getOverdue } = require('../controllers/dashboardController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

router.get('/stats', librarianOnly, getStats);
router.get('/overdue', librarianOnly, getOverdue);

module.exports = router;