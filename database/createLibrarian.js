const bcrypt = require('bcrypt');          // or 'bcryptjs'
const db = require('../config/database');

(async () => {
  const hash = await bcrypt.hash('librarian123', 10);
  db.prepare(
    `INSERT OR IGNORE INTO users (full_name, email, password_hash, role)
     VALUES (?, ?, ?, 'librarian')`
  ).run('Main Librarian', 'librarian@library.com', hash);
  console.log('Librarian created: librarian@library.com / librarian123');
})();