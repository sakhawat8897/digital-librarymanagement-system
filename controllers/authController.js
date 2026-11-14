const jwt = require('jsonwebtoken');
const bcrypt = require('../utils/bcrypt');
const { User, createWithId } = require('../models');

// REGISTER a new student
exports.register = async (req, res) => {
  try {
    const { full_name, email, password } = req.body || {};

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Is the email already used?
    if (await User.exists({ email: cleanEmail })) {
      return res.status(409).json({ error: 'This email is already registered' });
    }

    // Hash the password (never store the real password)
    const passwordHash = await bcrypt.hash(String(password), 10);

    // Everyone who registers here is a student ('member'), whatever the request says
    const userId = await createWithId(User, 'users', 'user_id', {
      full_name: String(full_name).trim(),
      email: cleanEmail,
      password_hash: passwordHash,
      role: 'member'
    });

    res.status(201).json({ message: 'Registration successful', user_id: userId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();

    // Same message for "no user" and "wrong password" (safer)
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This account is suspended' });
    }

    const passwordOk = await bcrypt.compare(String(password), user.password_hash);
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
