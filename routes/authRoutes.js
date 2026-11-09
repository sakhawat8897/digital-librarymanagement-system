const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);

// Test routes to check that protection works
router.get('/me', verifyToken, (req, res) => res.json({ user: req.user }));
router.get('/librarian-check', verifyToken, requireRole('librarian', 'admin'),
  (req, res) => res.json({ message: 'Welcome, librarian!' }));

module.exports = router;