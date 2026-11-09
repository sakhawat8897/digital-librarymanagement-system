PRAGMA foreign_keys = ON;

-- TABLE 1: USERS
CREATE TABLE IF NOT EXISTS users (
    user_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name       TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE,
    password_hash   TEXT    NOT NULL,
    phone           TEXT,
    role            TEXT    NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'librarian', 'admin')),
    status          TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended')),
    membership_date TEXT    NOT NULL DEFAULT (date('now')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- TABLE 2: BOOKS
CREATE TABLE IF NOT EXISTS books (
    book_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn             TEXT    NOT NULL UNIQUE,
    title            TEXT    NOT NULL,
    author           TEXT    NOT NULL,
    publisher        TEXT,
    category         TEXT,
    publication_year INTEGER CHECK (publication_year BETWEEN 1000 AND 2100),
    shelf_location   TEXT,
    total_copies     INTEGER NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
    available_copies INTEGER NOT NULL DEFAULT 1 CHECK (available_copies >= 0),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (available_copies <= total_copies)
);

-- TABLE 3: ISSUES
CREATE TABLE IF NOT EXISTS issues (
    issue_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    book_id       INTEGER NOT NULL,
    issue_date    TEXT    NOT NULL DEFAULT (date('now')),
    due_date      TEXT    NOT NULL,
    return_date   TEXT,
    fine_amount   REAL    NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
    fine_paid     INTEGER NOT NULL DEFAULT 0 CHECK (fine_paid IN (0, 1)),
    renewal_count INTEGER NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
    status        TEXT    NOT NULL DEFAULT 'issued'
                  CHECK (status IN ('issued', 'returned', 'overdue', 'lost')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE RESTRICT,
    CHECK (due_date >= issue_date),
    CHECK (return_date IS NULL OR return_date >= issue_date)
);

-- TABLE 4: RESERVATIONS
CREATE TABLE IF NOT EXISTS reservations (
    reservation_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    book_id          INTEGER NOT NULL,
    reservation_date TEXT    NOT NULL DEFAULT (date('now')),
    expiry_date      TEXT,
    status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'expired')),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
);

-- TABLE 5: RENEWALS
CREATE TABLE IF NOT EXISTS renewals (
    renewal_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id      INTEGER NOT NULL,
    request_date  TEXT    NOT NULL DEFAULT (date('now')),
    old_due_date  TEXT    NOT NULL,
    new_due_date  TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE,
    CHECK (new_due_date > old_due_date)
);
-- INDEXES (make searching faster)
CREATE INDEX IF NOT EXISTS idx_books_title       ON books(title);
CREATE INDEX IF NOT EXISTS idx_issues_user       ON issues(user_id);
CREATE INDEX IF NOT EXISTS idx_issues_book       ON issues(book_id);
CREATE INDEX IF NOT EXISTS idx_issues_status     ON issues(status);
CREATE INDEX IF NOT EXISTS idx_reservations_book ON reservations(book_id, status);
CREATE INDEX IF NOT EXISTS idx_renewals_issue    ON renewals(issue_id);