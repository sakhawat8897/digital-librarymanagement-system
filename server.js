require('dotenv').config();
const express = require('express');
const path = require('path');
const { connectDB } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/books', require('./routes/bookRoutes'));
app.use('/api/issues', require('./routes/issueRoutes'));
app.use('/api/fines', require('./routes/fineRoutes'));
app.use('/api/reservations', require('./routes/reservationRoutes'));
app.use('/api/renewals', require('./routes/renewalRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));

app.get('/api/health', (req, res) => {
  res.json({ message: 'Digital Library Management System is running' });
});

// Any error nobody caught: answer with JSON instead of a web page
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Start the server only after MongoDB is connected
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not connect to MongoDB:', err.message);
    console.error('Is MongoDB running? Check MONGO_URI in your .env file.');
    process.exit(1);
  });
