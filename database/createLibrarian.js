// Creates the librarian account (run once): node database/createLibrarian.js
require('dotenv').config();
const bcrypt = require('../utils/bcrypt');
const { connectDB, mongoose } = require('../config/database');
const { User, createWithId } = require('../models');

const EMAIL = 'librarian@library.com';
const PASSWORD = 'librarian123';   // change this for a real demonstration

(async () => {
  await connectDB();

  if (await User.exists({ email: EMAIL })) {
    console.log(`The librarian ${EMAIL} already exists.`);
  } else {
    await createWithId(User, 'users', 'user_id', {
      full_name: 'Main Librarian',
      email: EMAIL,
      password_hash: await bcrypt.hash(PASSWORD, 10),
      role: 'librarian'
    });
    console.log(`Librarian created: ${EMAIL} / ${PASSWORD}`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
