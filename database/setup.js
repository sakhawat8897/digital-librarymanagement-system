const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 1. Create (or open) the database file
const db = new Database(path.join(__dirname, 'library.db'));

// 2. Turn on foreign key checking
db.pragma('foreign_keys = ON');

// 3. Read schema.sql and run it
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('Database and tables created successfully!');
db.close();