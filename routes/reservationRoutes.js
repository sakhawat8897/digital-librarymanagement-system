const express = require('express');
const router = express.Router();
const { reserveBook, getMyReservations, getReservations, cancelReservation } =
  require('../controllers/reservationController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

router.get('/my', verifyToken, getMyReservations);                // before '/'
router.get('/', librarianOnly, getReservations);
router.post('/', verifyToken, requireRole('member'), reserveBook);
router.put('/:id/cancel', verifyToken, cancelReservation);

module.exports = router;