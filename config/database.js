const Database = require('better-sqlite3');
const path = require('path');

// Tests set DB_PATH to use a temporary database. Normally the real one is used.
const dbFile = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'library.db');

const db = new Database(dbFile);
db.pragma('foreign_keys = ON');

module.exports = db;