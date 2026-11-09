const db = require('../config/database');

const books = [
  ['9780000000011', 'Web Development Basics', 'John Smith', 'Tech Press', 'Computer Science', 2022, 'A-01', 5],
  ['9780000000028', 'JavaScript for Beginners', 'Sara Malik', 'Code House', 'Computer Science', 2021, 'A-02', 3],
  ['9780000000035', 'Database Systems', 'Ahmed Raza', 'Tech Press', 'Computer Science', 2020, 'A-03', 4],
  ['9780000000042', 'Introduction to Algorithms', 'Maria Khan', 'Academic Books', 'Computer Science', 2019, 'A-04', 2],
  ['9780000000059', 'Pakistan Studies', 'Usman Ali', 'National Press', 'History', 2018, 'B-01', 6],
  ['9780000000066', 'Calculus Made Simple', 'Hina Tariq', 'Academic Books', 'Mathematics', 2017, 'C-01', 4],
  ['9780000000073', 'Basic Physics', 'Bilal Hussain', 'Science House', 'Science', 2016, 'D-01', 3],
  ['9780000000080', 'English Grammar Guide', 'Ayesha Noor', 'Language Press', 'Language', 2015, 'E-01', 5]
];

const insert = db.prepare(
  `INSERT OR IGNORE INTO books
   (isbn, title, author, publisher, category, publication_year, shelf_location, total_copies, available_copies)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

for (const b of books) insert.run(...b, b[7]);   // available = total at the start
console.log('Sample books added.');