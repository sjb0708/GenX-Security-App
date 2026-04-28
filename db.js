'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL is not set. Add it to .env (local) or Vercel env vars (prod).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

pool.on('error', (err) => console.error('Postgres pool error:', err.message));

async function query(text, params) {
  return pool.query(text, params);
}

// ── Schema bootstrap ─────────────────────────────────────────────────────────
async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS briefs (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS portal_users (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      email           TEXT NOT NULL UNIQUE,
      role            TEXT NOT NULL,
      brief_id        TEXT,
      password_hash   TEXT NOT NULL,
      password_salt   TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS intake_tokens (
      token         TEXT PRIMARY KEY,
      brief_id      TEXT,
      venue_email   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL,
      used          BOOLEAN NOT NULL DEFAULT FALSE,
      cancelled     BOOLEAN NOT NULL DEFAULT FALSE,
      submitted_at  TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS travel_tokens (
      token         TEXT PRIMARY KEY,
      brief_id      TEXT,
      name          TEXT,
      email         TEXT,
      role          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL,
      submitted     BOOLEAN NOT NULL DEFAULT FALSE,
      cancelled     BOOLEAN NOT NULL DEFAULT FALSE,
      submitted_at  TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS roster (
      id          TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS photos (
      id          TEXT PRIMARY KEY,
      name        TEXT,
      url         TEXT NOT NULL,
      added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      id    INT PRIMARY KEY DEFAULT 1,
      data  JSONB NOT NULL DEFAULT '{}'::jsonb,
      CHECK (id = 1)
    );
    INSERT INTO settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
  `);
}

// ── Briefs ───────────────────────────────────────────────────────────────────
async function getBrief(id) {
  const r = await query('SELECT data FROM briefs WHERE id = $1', [id]);
  return r.rows[0]?.data || null;
}
async function listBriefs() {
  const r = await query('SELECT data FROM briefs ORDER BY updated_at DESC');
  return r.rows.map(row => row.data);
}
async function upsertBrief(brief) {
  const id = brief.id;
  await query(
    `INSERT INTO briefs (id, data, created_at, updated_at)
     VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [id, brief, brief.createdAt || null]
  );
}
async function deleteBrief(id) {
  const r = await query('DELETE FROM briefs WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// ── Portal users ─────────────────────────────────────────────────────────────
async function listUsers() {
  const r = await query('SELECT id, name, email, role, brief_id, created_at FROM portal_users ORDER BY created_at');
  return r.rows.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, briefId: u.brief_id, createdAt: u.created_at }));
}
async function getUserById(id) {
  const r = await query('SELECT * FROM portal_users WHERE id = $1', [id]);
  const u = r.rows[0];
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, briefId: u.brief_id, passwordHash: u.password_hash, passwordSalt: u.password_salt, createdAt: u.created_at };
}
async function getUserByEmail(email) {
  const r = await query('SELECT * FROM portal_users WHERE LOWER(email) = LOWER($1)', [email]);
  const u = r.rows[0];
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, briefId: u.brief_id, passwordHash: u.password_hash, passwordSalt: u.password_salt, createdAt: u.created_at };
}
async function insertUser(user) {
  await query(
    `INSERT INTO portal_users (id, name, email, role, brief_id, password_hash, password_salt, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [user.id, user.name, user.email, user.role, user.briefId || null, user.passwordHash, user.passwordSalt]
  );
}
async function updateUser(id, patch) {
  const fields = [];
  const values = [];
  let i = 1;
  if (patch.name !== undefined)         { fields.push(`name = $${i++}`);          values.push(patch.name); }
  if (patch.email !== undefined)        { fields.push(`email = $${i++}`);         values.push(patch.email); }
  if (patch.role !== undefined)         { fields.push(`role = $${i++}`);          values.push(patch.role); }
  if (patch.briefId !== undefined)      { fields.push(`brief_id = $${i++}`);      values.push(patch.briefId || null); }
  if (patch.passwordHash !== undefined) { fields.push(`password_hash = $${i++}`); values.push(patch.passwordHash); }
  if (patch.passwordSalt !== undefined) { fields.push(`password_salt = $${i++}`); values.push(patch.passwordSalt); }
  if (!fields.length) return;
  values.push(id);
  await query(`UPDATE portal_users SET ${fields.join(', ')} WHERE id = $${i}`, values);
}
async function deleteUser(id) {
  const r = await query('DELETE FROM portal_users WHERE id = $1', [id]);
  return r.rowCount > 0;
}
async function emailExists(email) {
  const r = await query('SELECT 1 FROM portal_users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  return r.rowCount > 0;
}

// ── Intake tokens ────────────────────────────────────────────────────────────
async function getIntakeToken(token) {
  const r = await query('SELECT * FROM intake_tokens WHERE token = $1', [token]);
  return r.rows[0] ? mapIntakeRow(r.rows[0]) : null;
}
function mapIntakeRow(t) {
  return {
    token: t.token, briefId: t.brief_id, venueEmail: t.venue_email,
    createdAt: t.created_at, expiresAt: t.expires_at,
    used: t.used, cancelled: t.cancelled, submittedAt: t.submitted_at
  };
}
async function insertIntakeToken(t) {
  await query(
    `INSERT INTO intake_tokens (token, brief_id, venue_email, expires_at, used, cancelled)
     VALUES ($1, $2, $3, $4, FALSE, FALSE)`,
    [t.token, t.briefId, t.venueEmail, t.expiresAt]
  );
}
async function markIntakeSubmitted(token) {
  await query('UPDATE intake_tokens SET used = TRUE, submitted_at = NOW() WHERE token = $1', [token]);
}
async function cancelIntakeTokensForBrief(briefId) {
  await query('UPDATE intake_tokens SET cancelled = TRUE WHERE brief_id = $1 AND used = FALSE AND cancelled = FALSE', [briefId]);
}
async function deleteIntakeToken(token) {
  await query('DELETE FROM intake_tokens WHERE token = $1', [token]);
}
async function sweepStaleIntakeTokens() {
  const r = await query(
    `DELETE FROM intake_tokens
     WHERE (used = TRUE OR cancelled = TRUE OR expires_at < NOW())
       AND expires_at < NOW() - INTERVAL '30 days'`
  );
  return r.rowCount;
}

// ── Travel tokens ────────────────────────────────────────────────────────────
async function getTravelToken(token) {
  const r = await query('SELECT * FROM travel_tokens WHERE token = $1', [token]);
  return r.rows[0] ? mapTravelRow(r.rows[0]) : null;
}
function mapTravelRow(t) {
  return {
    token: t.token, briefId: t.brief_id, name: t.name, email: t.email, role: t.role,
    createdAt: t.created_at, expiresAt: t.expires_at,
    submitted: t.submitted, cancelled: t.cancelled, submittedAt: t.submitted_at
  };
}
async function insertTravelToken(t) {
  await query(
    `INSERT INTO travel_tokens (token, brief_id, name, email, role, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [t.token, t.briefId, t.name, t.email, t.role || '', t.expiresAt]
  );
}
async function markTravelSubmitted(token) {
  await query('UPDATE travel_tokens SET submitted = TRUE, submitted_at = NOW() WHERE token = $1', [token]);
}
async function cancelTravelTokensFor(briefId, email) {
  await query('UPDATE travel_tokens SET cancelled = TRUE WHERE brief_id = $1 AND email = $2 AND submitted = FALSE AND cancelled = FALSE', [briefId, email]);
}
async function deleteTravelToken(token) {
  await query('DELETE FROM travel_tokens WHERE token = $1', [token]);
}
async function listPendingTravelForBrief(briefId) {
  const r = await query(
    `SELECT * FROM travel_tokens
     WHERE brief_id = $1 AND submitted = FALSE AND cancelled = FALSE AND expires_at >= NOW()`,
    [briefId]
  );
  return r.rows.map(mapTravelRow);
}
async function sweepStaleTravelTokens() {
  const r = await query(
    `DELETE FROM travel_tokens
     WHERE (submitted = TRUE OR cancelled = TRUE OR expires_at < NOW())
       AND expires_at < NOW() - INTERVAL '30 days'`
  );
  return r.rowCount;
}

// ── Roster ───────────────────────────────────────────────────────────────────
async function listRoster() {
  const r = await query('SELECT data FROM roster ORDER BY created_at');
  return r.rows.map(row => row.data);
}
async function insertRosterPerson(person) {
  await query('INSERT INTO roster (id, data, created_at) VALUES ($1, $2, NOW())', [person.id, person]);
}
async function updateRosterPerson(id, person) {
  await query('UPDATE roster SET data = $2 WHERE id = $1', [id, person]);
}
async function deleteRosterPerson(id) {
  const r = await query('DELETE FROM roster WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// ── Photos ───────────────────────────────────────────────────────────────────
async function listPhotos() {
  const r = await query('SELECT id, name, url, added_at FROM photos ORDER BY added_at DESC');
  return r.rows.map(p => ({ id: p.id, name: p.name, url: p.url, addedAt: p.added_at }));
}
async function insertPhotos(photos) {
  if (!photos.length) return;
  const values = [];
  const placeholders = photos.map((p, i) => {
    const base = i * 3;
    values.push(p.id, p.name, p.url);
    return `($${base + 1}, $${base + 2}, $${base + 3}, NOW())`;
  });
  await query(`INSERT INTO photos (id, name, url, added_at) VALUES ${placeholders.join(', ')}`, values);
}
async function deletePhoto(id) {
  const r = await query('DELETE FROM photos WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// ── Settings (single-row jsonb) ──────────────────────────────────────────────
async function getSettings() {
  const r = await query('SELECT data FROM settings WHERE id = 1');
  return r.rows[0]?.data || {};
}
async function saveSettings(data) {
  await query('UPDATE settings SET data = $1 WHERE id = 1', [data]);
}

module.exports = {
  pool, query, initSchema,
  getBrief, listBriefs, upsertBrief, deleteBrief,
  listUsers, getUserById, getUserByEmail, insertUser, updateUser, deleteUser, emailExists,
  getIntakeToken, insertIntakeToken, markIntakeSubmitted, cancelIntakeTokensForBrief, deleteIntakeToken, sweepStaleIntakeTokens,
  getTravelToken, insertTravelToken, markTravelSubmitted, cancelTravelTokensFor, deleteTravelToken, listPendingTravelForBrief, sweepStaleTravelTokens,
  listRoster, insertRosterPerson, updateRosterPerson, deleteRosterPerson,
  listPhotos, insertPhotos, deletePhoto,
  getSettings, saveSettings
};
