const express = require('express');
const session = require('express-session');
const csrf = require('csurf');
const path = require('path');
const methodOverride = require('method-override');
const dayjs = require('dayjs');
const { initDb, get, all, run } = require('./db');

const app = express();

initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(session({
  secret: 'absensi-supi-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));
const csrfProtection = process.env.DISABLE_CSRF === 'true' ? ((req, res, next) => next()) : csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.dayjs = dayjs;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  try {
    res.locals._csrf = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
  } catch (e) {
    res.locals._csrf = null;
  }
  next();
});

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function ensureRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

const bcrypt = require('bcryptjs');
const fs = require('fs');
const LOG_PATH = path.join(__dirname, '..', 'data', 'server.log');
function log(msg) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'ADMIN') return res.redirect('/admin');
    if (req.session.user.role === 'GURU') return res.redirect('/guru');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    log('POST /login start');
    const { username, password } = req.body;
    if (typeof username !== 'string' || !username.length) return res.render('login', { error: 'Masukkan username/email' });
    if (typeof password !== 'string' || !password.length) return res.render('login', { error: 'Masukkan password' });
    const user = await get('SELECT * FROM users WHERE (username = ? OR email = ?) AND active = 1', [username, username]);
    log('User fetched ' + (user ? user.username : 'null'));
    if (!user || !user.password_hash) return res.render('login', { error: 'Akun tidak ditemukan atau nonaktif' });
    const ok = bcrypt.compareSync(password, String(user.password_hash));
    log('Password compare ' + ok);
    if (!ok) return res.render('login', { error: 'Password salah' });
    req.session.user = { id: user.id, name: user.name, role: user.role };
    req.session.flash = { type: 'success', message: 'Berhasil login' };
    if (user.role === 'ADMIN') return res.redirect('/admin');
    if (user.role === 'GURU') return res.redirect('/guru');
    res.redirect('/login');
  } catch (e) {
    log('Login error ' + (e && e.stack ? e.stack : e));
    return res.render('login', { error: 'Terjadi kesalahan, coba lagi' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/admin', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const teacherCount = (await get("SELECT COUNT(*) AS c FROM users WHERE role='GURU'")).c;
  const studentCount = (await get("SELECT COUNT(*) AS c FROM students")).c;
  res.render('admin/dashboard', { teacherCount, studentCount });
});

app.get('/admin/guru', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const gurus = await all("SELECT id, name, email, username, subject, active FROM users WHERE role='GURU' ORDER BY name");
  res.render('admin/guru_list', { gurus });
});

app.post('/admin/guru', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const { name, email, username, subject, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  await run("INSERT INTO users (name, email, username, password_hash, role, subject, active) VALUES (?, ?, ?, ?, 'GURU', ?, 1)", [name, email, username, hash, subject]);
  req.session.flash = { type: 'success', message: 'Akun guru ditambahkan' };
  res.redirect('/admin/guru');
});

app.post('/admin/guru/:id/toggle', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const id = req.params.id;
  const user = await get('SELECT active FROM users WHERE id=? AND role="GURU"', [id]);
  if (user) {
    const newActive = user.active ? 0 : 1;
    await run('UPDATE users SET active=? WHERE id=?', [newActive, id]);
  }
  req.session.flash = { type: 'success', message: 'Status akun guru diperbarui' };
  res.redirect('/admin/guru');
});

app.post('/admin/guru/:id', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const id = req.params.id;
  const { name, email, username, subject } = req.body;
  await run('UPDATE users SET name=?, email=?, username=?, subject=? WHERE id=? AND role="GURU"', [name, email, username, subject, id]);
  req.session.flash = { type: 'success', message: 'Data guru diperbarui' };
  res.redirect('/admin/guru');
});

app.get('/admin/siswa', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const students = await all(`
    SELECT s.id, s.name, s.class_level, s.active, u.name AS teacher_name
    FROM students s LEFT JOIN users u ON s.teacher_id = u.id
    ORDER BY s.class_level, s.name
  `);
  res.render('admin/students', { students });
});

app.get('/admin/monitoring', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const { date } = req.query;
  const d = date || dayjs().format('YYYY-MM-DD');
  const teachers = await all("SELECT id, name FROM users WHERE role='GURU' AND active=1 ORDER BY name");
  const statuses = await all("SELECT * FROM teacher_attendance_status WHERE date=?", [d]);
  const map = {};
  for (const s of statuses) map[s.teacher_id] = s;
  const result = teachers.map(t => {
    const s = map[t.id];
    const done = s ? s.status === 'DONE' : false;
    const reason = s ? s.reason : null;
    return { teacher: t, done, reason };
  });
  res.render('admin/monitoring', { date: d, result });
});

app.get('/admin/export/absensi', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const d = req.query.date || dayjs().format('YYYY-MM-DD');
  const rows = await all(`
    SELECT a.date, u.name AS guru, s.name AS siswa, s.class_level, a.status, a.sick_date, a.izin_start_date, a.izin_days, a.izin_reason, a.created_at
    FROM attendance a
    JOIN users u ON a.teacher_id = u.id
    JOIN students s ON a.student_id = s.id
    WHERE a.date = ?
    ORDER BY u.name, s.class_level, s.name
  `, [d]);
  const header = ['Tanggal','Guru','Siswa','Kelas','Status','Tanggal Sakit','Mulai Izin','Hari Izin','Alasan Izin','Waktu Input'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const line = [
      r.date, r.guru, r.siswa, r.class_level, r.status,
      r.sick_date || '', r.izin_start_date || '', r.izin_days || '', (r.izin_reason || '').replace(/,/g,';'), r.created_at
    ].join(',');
    lines.push(line);
  }
  const csv = lines.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="rekap-${d}.csv"`);
  res.send(csv);
});

app.get('/admin/rekap-siswa', ensureAuth, ensureRole('ADMIN'), async (req, res) => {
  const d = req.query.date || dayjs().format('YYYY-MM-DD');
  const cls = parseInt(req.query.class_level, 10);
  let students;
  if ([7,8,9].includes(cls)) {
    students = await all(`
      SELECT s.id, s.name, s.class_level, s.active, u.name AS teacher_name
      FROM students s JOIN users u ON s.teacher_id = u.id
      WHERE s.class_level=? ORDER BY s.name
    `, [cls]);
  } else {
    students = await all(`
      SELECT s.id, s.name, s.class_level, s.active, u.name AS teacher_name
      FROM students s JOIN users u ON s.teacher_id = u.id
      ORDER BY s.class_level, s.name
    `);
  }
  const att = await all(`
    SELECT a.student_id, a.status, a.sick_date, a.izin_start_date, a.izin_days, a.izin_reason
    FROM attendance a WHERE a.date=?
  `, [d]);
  const map = {};
  for (const a of att) map[a.student_id] = a;
  const rows = students.map(s => {
    const a = map[s.id];
    let status = 'Belum Diinput';
    let detail = '';
    if (a) {
      status = a.status;
      if (a.status === 'SAKIT') detail = a.sick_date || '';
      if (a.status === 'IZIN') detail = `${a.izin_start_date || ''} (${a.izin_days || 1} hari) ${a.izin_reason || ''}`;
    }
    const tidakHadir = status !== 'HADIR';
    return { siswa: s.name, kelas: s.class_level, guru: s.teacher_name, status, detail, tidakHadir };
  });
  res.render('admin/rekap_siswa', { date: d, class_level: [7,8,9].includes(cls) ? cls : '', rows });
});

app.get('/guru', ensureAuth, ensureRole('GURU'), async (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  const status = await get('SELECT * FROM teacher_attendance_status WHERE teacher_id=? AND date=?', [req.session.user.id, today]);
  const studentsCount = (await get('SELECT COUNT(*) AS c FROM students WHERE teacher_id=?', [req.session.user.id])).c;
  res.render('guru/dashboard', { today, status, studentsCount });
});

app.post('/guru/status', ensureAuth, ensureRole('GURU'), async (req, res) => {
  const { status, reason, date } = req.body;
  const d = date || dayjs().format('YYYY-MM-DD');
  const existing = await get('SELECT id FROM teacher_attendance_status WHERE teacher_id=? AND date=?', [req.session.user.id, d]);
  if (existing) {
    await run('UPDATE teacher_attendance_status SET status=?, reason=? WHERE id=?', [status, status === 'NOT_DONE' ? (reason || '') : null, existing.id]);
  } else {
    await run('INSERT INTO teacher_attendance_status (teacher_id, date, status, reason) VALUES (?, ?, ?, ?)', [req.session.user.id, d, status, status === 'NOT_DONE' ? (reason || '') : null]);
  }
  req.session.flash = { type: 'success', message: 'Status harian tersimpan' };
  res.redirect('/guru');
});

app.get('/guru/siswa', ensureAuth, ensureRole('GURU'), async (req, res) => {
  const cls = parseInt(req.query.class_level, 10);
  let students;
  if ([7,8,9].includes(cls)) {
    students = await all('SELECT * FROM students WHERE teacher_id=? AND class_level=? ORDER BY class_level, name', [req.session.user.id, cls]);
  } else {
    students = await all('SELECT * FROM students WHERE teacher_id=? ORDER BY class_level, name', [req.session.user.id]);
  }
  res.render('guru/students', { students, class_level: [7,8,9].includes(cls) ? cls : undefined });
});

app.post('/guru/siswa', ensureAuth, ensureRole('GURU'), async (req, res) => {
  const { name, class_level } = req.body;
  const cls = parseInt(class_level, 10);
  if (![7,8,9].includes(cls)) return res.status(400).send('Kelas harus 7/8/9');
  await run('INSERT INTO students (name, class_level, active, teacher_id) VALUES (?, ?, 1, ?)', [name, cls, req.session.user.id]);
  req.session.flash = { type: 'success', message: 'Siswa ditambahkan' };
  res.redirect('/guru/siswa');
});

app.post('/guru/siswa/:id/toggle', ensureAuth, ensureRole('GURU'), async (req, res) => {
  const id = req.params.id;
  const s = await get('SELECT active FROM students WHERE id=? AND teacher_id=?', [id, req.session.user.id]);
  if (s) {
    const newActive = s.active ? 0 : 1;
    await run('UPDATE students SET active=? WHERE id=? AND teacher_id=?', [newActive, id, req.session.user.id]);
  }
  req.session.flash = { type: 'success', message: 'Status siswa diperbarui' };
  res.redirect('/guru/siswa');
});

app.get('/guru/absensi', ensureAuth, ensureRole('GURU'), asyncHandler(async (req, res) => {
  const { date } = req.query;
  const d = date || dayjs().format('YYYY-MM-DD');
  const students = await all('SELECT * FROM students WHERE teacher_id=? AND active=1 ORDER BY class_level, name', [req.session.user.id]);
  const existing = await all('SELECT * FROM attendance WHERE teacher_id=? AND date=?', [req.session.user.id, d]);
  const map = {};
  for (const a of existing) map[a.student_id] = a;
  res.render('guru/absensi', { date: d, students, existingMap: map });
}));

app.post('/guru/absensi', ensureAuth, ensureRole('GURU'), asyncHandler(async (req, res) => {
  const { date } = req.body;
  const d = date || dayjs().format('YYYY-MM-DD');
  const students = await all('SELECT id FROM students WHERE teacher_id=? AND active=1 ORDER BY class_level, name', [req.session.user.id]);
  await run('BEGIN');
  try {
    for (const s of students) {
      const sid = s.id;
      const status = req.body['status_' + sid] || null;
      if (!status) continue;
      let sick_date = null, izin_start_date = null, izin_days = null, izin_reason = null;
      if (status === 'SAKIT') sick_date = req.body['sick_date_' + sid] || d;
      if (status === 'IZIN') {
        izin_start_date = req.body['izin_start_date_' + sid] || d;
        const daysRaw = req.body['izin_days_' + sid];
        izin_days = daysRaw ? parseInt(daysRaw, 10) || 1 : 1;
        izin_reason = (req.body['izin_reason_' + sid] || '').toString();
      }
      const existing = await get('SELECT id FROM attendance WHERE student_id=? AND teacher_id=? AND date=?', [sid, req.session.user.id, d]);
      if (existing) {
        await run(`
          UPDATE attendance SET status=?, sick_date=?, izin_start_date=?, izin_days=?, izin_reason=?, created_at=?
          WHERE id=?
        `, [status, sick_date, izin_start_date, izin_days, izin_reason, dayjs().toISOString(), existing.id]);
      } else {
        await run(`
          INSERT INTO attendance (student_id, teacher_id, date, status, sick_date, izin_start_date, izin_days, izin_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [sid, req.session.user.id, d, status, sick_date, izin_start_date, izin_days, izin_reason, dayjs().toISOString()]);
      }
    }
    await run('INSERT OR REPLACE INTO teacher_attendance_status (teacher_id, date, status) VALUES (?, ?, ?)', [req.session.user.id, d, 'DONE']);
    await run('COMMIT');
  } catch (e) {
    await run('ROLLBACK');
    throw e;
  }
  req.session.flash = { type: 'success', message: 'Absensi siswa tersimpan' };
  res.redirect('/guru/absensi?date=' + d);
}));

app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Token tidak valid');
  }
  console.error(err && err.stack ? err.stack : err);
  log('Global error ' + (err && err.stack ? err.stack : err));
  res.status(500).send(err && err.stack ? err.stack : (err && err.message ? err.message : 'Terjadi kesalahan server'));
});

app.get('/guru/akun', ensureAuth, ensureRole('GURU'), (req, res) => {
  res.render('guru/account', { error: null, success: null });
});

app.post('/guru/akun/password', ensureAuth, ensureRole('GURU'), asyncHandler(async (req, res) => {
  const { old_password, new_password } = req.body;
  const user = await get('SELECT * FROM users WHERE id=?', [req.session.user.id]);
  if (!user || !bcrypt.compareSync(old_password, user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Password lama salah' };
    return res.redirect('/guru/akun');
  }
  const hash = bcrypt.hashSync(new_password, 10);
  await run('UPDATE users SET password_hash=? WHERE id=?', [hash, req.session.user.id]);
  req.session.flash = { type: 'success', message: 'Password berhasil diubah' };
  res.redirect('/guru/akun');
}));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on http://localhost:' + PORT);
});
