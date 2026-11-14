const mongoose = require('mongoose');
const { Schema } = mongoose;
const { todayLocal } = require('../utils/library');

// created_at is filled in automatically
const timestamps = { timestamps: { createdAt: 'created_at', updatedAt: false } };

// ---------- Users ----------
const User = mongoose.model('User', new Schema({
  user_id:         { type: Number, required: true, unique: true },
  full_name:       { type: String, required: true, trim: true },
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash:   { type: String, required: true },
  phone:           { type: String, default: null },
  role:            { type: String, enum: ['member', 'librarian', 'admin'], default: 'member' },
  status:          { type: String, enum: ['active', 'suspended'], default: 'active' },
  membership_date: { type: String, default: () => todayLocal() }
}, timestamps));

// ---------- Books ----------
const Book = mongoose.model('Book', new Schema({
  book_id:          { type: Number, required: true, unique: true },
  isbn:             { type: String, required: true, unique: true, trim: true },
  title:            { type: String, required: true, trim: true },
  author:           { type: String, required: true, trim: true },
  publisher:        { type: String, default: null },
  category:         { type: String, default: null },
  publication_year: { type: Number, min: 1000, max: 2100, default: null },
  shelf_location:   { type: String, default: null },
  total_copies:     { type: Number, required: true, min: 0, default: 1 },
  available_copies: { type: Number, required: true, min: 0, default: 1 }
}, timestamps));

// ---------- Issues (one borrowed copy) ----------
const Issue = mongoose.model('Issue', new Schema({
  issue_id:      { type: Number, required: true, unique: true },
  user_id:       { type: Number, required: true, index: true },
  book_id:       { type: Number, required: true, index: true },
  issue_date:    { type: String, required: true },
  due_date:      { type: String, required: true },
  return_date:   { type: String, default: null },        // null = not returned yet
  fine_amount:   { type: Number, default: 0, min: 0 },
  fine_paid:     { type: Number, default: 0, enum: [0, 1] },
  renewal_count: { type: Number, default: 0, min: 0 },
  status:        { type: String, enum: ['issued', 'returned', 'overdue', 'lost'], default: 'issued' }
}, timestamps));

// ---------- Reservations ----------
const Reservation = mongoose.model('Reservation', new Schema({
  reservation_id:   { type: Number, required: true, unique: true },
  user_id:          { type: Number, required: true, index: true },
  book_id:          { type: Number, required: true, index: true },
  reservation_date: { type: String, required: true },
  expiry_date:      { type: String, default: null },
  status:           { type: String, enum: ['pending', 'fulfilled', 'cancelled', 'expired'], default: 'pending' }
}, timestamps));

// ---------- Renewals (requests to extend a due date) ----------
const Renewal = mongoose.model('Renewal', new Schema({
  renewal_id:   { type: Number, required: true, unique: true },
  issue_id:     { type: Number, required: true, index: true },
  request_date: { type: String, required: true },
  old_due_date: { type: String, required: true },
  new_due_date: { type: String, required: true },
  status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, timestamps));

// ---------- Counters: give every record a simple number (1, 2, 3...) ----------
// MongoDB's own ids are long text. The website and the API use plain numbers,
// so this counter hands out the next number for each kind of record.
const Counter = mongoose.model('Counter', new Schema({
  _id: String,
  seq: { type: Number, default: 0 }
}));

async function nextId(name) {
  // Two requests creating the very first counter at the same moment can collide.
  // If that happens, simply try again.
  for (let attempt = 1; ; attempt++) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
      );
      return counter.seq;
    } catch (err) {
      if (err.code === 11000 && attempt < 5) continue;
      throw err;
    }
  }
}


// Creates a record with the next free number.
// If the database says that number is already taken (two requests got the same
// number at the same moment), it takes a new number and tries again.
// If another unique field clashed instead (an email or an ISBN), the error is passed on.
async function createWithId(Model, counterName, idField, data) {
  for (let attempt = 1; ; attempt++) {
    const id = await nextId(counterName);
    try {
      await Model.create({ ...data, [idField]: id });
      return id;
    } catch (err) {
      if (err.code === 11000 && attempt < 10 && await Model.exists({ [idField]: id })) continue;
      throw err;
    }
  }
}

module.exports = { User, Book, Issue, Reservation, Renewal, Counter, nextId, createWithId };
