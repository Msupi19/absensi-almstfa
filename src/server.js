// =========================
// IMPORT
// =========================
const express = require('express');
const path = require('path');

// =========================
// INIT APP
// =========================
const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// MIDDLEWARE
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static files (css, js, img)
app.use(express.static(path.join(__dirname, '../public')));

// view engine
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// =========================
// ROUTES
// =========================

// home
app.get('/', (req, res) => {
  res.send('✅ Server Absensi berjalan dengan baik');
});

// contoh halaman dashboard
app.get('/dashboard', (req, res) => {
  res.render('dashboard', {
    title: 'Dashboard Absensi'
  });
});

// health check (penting buat hosting)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// =========================
// 404 HANDLER
// =========================
app.use((req, res) => {
  res.status(404).send('❌ Halaman tidak ditemukan');
});

// =========================
// RUN SERVER
// =========================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
