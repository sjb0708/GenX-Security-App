'use strict';
// One-shot seed: pushes bundled demo briefs and demo users into Neon if the tables are empty.
// Safe to re-run — it will skip rows that already exist.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

(async () => {
  await db.initSchema();

  // Demo briefs
  const briefs = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-data.json'), 'utf8'));
  for (const [id, brief] of Object.entries(briefs)) {
    const existing = await db.getBrief(id);
    if (!existing) {
      await db.upsertBrief({ ...brief, id });
      console.log(`+ brief ${id} (${brief.venue?.name || 'untitled'})`);
    } else {
      console.log(`= brief ${id} already exists, skipping`);
    }
  }

  // Demo users
  const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-users.json'), 'utf8'));
  for (const [id, u] of Object.entries(users)) {
    const existing = await db.getUserById(id);
    if (!existing) {
      await db.insertUser({
        id: u.id, name: u.name, email: u.email, role: u.role, briefId: u.briefId,
        passwordHash: u.passwordHash, passwordSalt: u.passwordSalt
      });
      console.log(`+ user ${u.email} (${u.role})`);
    } else {
      console.log(`= user ${u.email} already exists, skipping`);
    }
  }

  console.log('\nSeed complete.');
  process.exit(0);
})().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
