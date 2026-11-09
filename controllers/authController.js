const bcrypt = require('bcrypt');          // use 'bcryptjs' if bcrypt failed to install
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// REGISTER a new student
exports.register = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Is the email already used?
    const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered' });
    }

    // Hash the password (never store the real password)
    const passwordHash = await bcrypt.hash(password, 10);

    // Everyone who registers here is a student ('member')
    const result = db.prepare(
      `INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'member')`
    ).run(full_name.trim(), cleanEmail, passwordHash);

    res.status(201).json({ message: 'Registration successful', user_id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());

    // Same message for "no user" and "wrong password" (safer)
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This account is suspended' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create the JWT token
    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, full_name: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { user_id: user.user_id, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};