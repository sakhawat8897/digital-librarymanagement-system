const express = require('express');
const router = express.Router();
const {
  requestRenewal, getEligible, getMyRenewals, getRenewals, approveRenewal, rejectRenewal
} = require('../controllers/renewalController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const librarianOnly = [verifyToken, requireRole('librarian', 'admin')];

router.get('/my', verifyToken, getMyRenewals);          // before '/'
router.get('/eligible', verifyToken, getEligible);
router.get('/', librarianOnly, getRenewals);
router.post('/', verifyToken, requireRole('member'), requestRenewal);
router.put('/:id/approve', librarianOnly, approveRenewal);
router.put('/:id/reject', librarianOnly, rejectRenewal);

module.exports = router;