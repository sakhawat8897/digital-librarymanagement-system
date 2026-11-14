const mongoose = require('mongoose');

// 127.0.0.1 is used instead of "localhost" because newer Node versions
// can resolve "localhost" to an address MongoDB is not listening on.
async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/digital_library';

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  // Make sure the unique indexes (email, ISBN, ids) exist before serving requests
  const models = require('../models');
  await Promise.all(
    ['User', 'Book', 'Issue', 'Reservation', 'Renewal'].map((name) => models[name].init())
  );

  console.log('MongoDB connected');
}

module.exports = { connectDB, mongoose };
