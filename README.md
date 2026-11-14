# Digital Library Management System

Semester project for **Web Technologies**, BSCS 6th Semester, 2026.

Created by: YOUR NAME (ROLL NUMBER)

## Problem

Book issue and return records are kept manually, and students cannot check whether a book is available.

## Features

- Book catalog with search by title, author and category
- Issue, return and renewal of books
- Automatic fine calculation for late returns
- Book reservation queue
- Librarian dashboard with an overdue list
- Role-based login (student and librarian)

## Technologies

HTML, CSS, JavaScript, Bootstrap, Node.js, Express.js, SQLite, JWT, bcrypt

## How to run

1. Install Node.js (LTS version) from https://nodejs.org
2. Download this project and open a terminal in its folder
3. Install packages:

```
npm install
```

4. Create a file named `.env` (copy `.env.example`) and set your own `JWT_SECRET`
5. Create the database and the librarian account:

```
Install MongoDB Community Server, then:
node database/createLibrarian.js
node database/seedBooks.js
```

6. Start the server:

```
node server.js
```

7. Open http://localhost:3000

## Demo librarian account

- Email: librarian@library.com
- Password: (the password set in `database/createLibrarian.js`)

Students create their own accounts on the Register page.

## Testing

```
npm test
```

Runs 155 automated checks on a temporary database. API requests were also tested in Postman.