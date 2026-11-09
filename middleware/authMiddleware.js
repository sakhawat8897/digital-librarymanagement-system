const jwt = require('jsonwebtoken');

// Checks that the request has a valid login token
exports.verifyToken = (req, res, next) => {
  const header = req.headers['authorization'];           // "Bearer <token>"
  const token = header && header.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Please login first' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // saves user info on the request
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Allows only certain roles, e.g. requireRole('librarian', 'admin')
exports.requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You are not allowed to do this' });
  }
  next();
};