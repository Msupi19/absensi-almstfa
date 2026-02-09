const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'data', 'absensi.db');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function (err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, function (err, rows) {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        username TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ADMIN','GURU')),
        subject TEXT,
        active INTEGER DEFAULT 1
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        class_level INTEGER NOT NULL CHECK(class_level IN (7,8,9)),
        active INTEGER DEFAULT 1,
        teacher_id INTEGER NOT NULL,
        FOREIGN KEY (teacher_id) REFERENCES users(id)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        teacher_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('HADIR','SAKIT','IZIN')),
        sick_date TEXT,
        izin_start_date TEXT,
        izin_days INTEGER,
        izin_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id),
        FOREIGN KEY (teacher_id) REFERENCES users(id),
        UNIQUE(student_id, teacher_id, date)
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS teacher_attendance_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('DONE','NOT_DONE')),
        reason TEXT,
        UNIQUE(teacher_id, date),
        FOREIGN KEY (teacher_id) REFERENCES users(id)
      )
    `);
    db.get(`SELECT COUNT(*) AS c FROM users WHERE role='ADMIN'`, (err, row) => {
      if (row && row.c === 0) {
        const hash = bcrypt.hashSync('admin123', 10);
        db.run(`INSERT INTO users (name, email, username, password_hash, role, active)
                VALUES ('Administrator', 'admin@example.com', 'admin', ?, 'ADMIN', 1)`, [hash]);
        console.log('Seeded default admin: username=admin password=admin123');
      }
    });
  });
}

module.exports = {
  run, get, all, initDb
};
