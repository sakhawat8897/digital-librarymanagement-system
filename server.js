require('dotenv').config();
const express = require('express');
const path = require('path');
require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve Bootstrap and fonts from this project, so the site works without internet
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/fonts', express.static(path.join(__dirname, 'node_modules', '@fontsource')));

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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});