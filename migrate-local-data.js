'use strict';
// Migrate local JSON files into Neon. Safe to re-run: brief upsert overwrites,
// roster/photos/tokens skip rows that already exist.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

function tryRead(file) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); } catch (_) { return null; }
}

(async () => {
  await db.initSchema();

  // Briefs (overwrite — local is the source of truth at migration time)
  const briefs = tryRead('.briefs.json') || {};
  let briefCount = 0;
  for (const [id, brief] of Object.entries(briefs)) {
    await db.upsertBrief({ ...brief, id });
    briefCount++;
    console.log(`+ brief ${id} (${brief.venue?.name || 'untitled'})`);
  }
  console.log(`Briefs: ${briefCount} migrated.\n`);

  // Roster (skip duplicates by id)
  const roster = tryRead('.roster.json') || [];
  const existingRoster = await db.listRoster();
  const existingRosterIds = new Set(existingRoster.map(p => p.id));
  let rosterCount = 0;
  for (const person of roster) {
    if (existingRosterIds.has(person.id)) {
      console.log(`= roster ${person.name} already exists, skipping`);
      continue;
    }
    await db.insertRosterPerson(person);
    rosterCount++;
    console.log(`+ roster ${person.name} (${person.category})`);
  }
  console.log(`Roster: ${rosterCount} migrated, ${roster.length - rosterCount} skipped.\n`);

  // Photos
  const photos = tryRead('.photos.json') || [];
  const existingPhotos = await db.listPhotos();
  const existingPhotoIds = new Set(existingPhotos.map(p => p.id));
  const photosToInsert = photos.filter(p => !existingPhotoIds.has(p.id));
  if (photosToInsert.length) {
    await db.insertPhotos(photosToInsert);
    console.log(`Photos: ${photosToInsert.length} migrated, ${photos.length - photosToInsert.length} skipped.\n`);
  } else {
    console.log(`Photos: 0 migrated, ${photos.length} already in DB.\n`);
  }

  // Intake tokens
  const tokens = tryRead('.tokens.json') || {};
  let tCount = 0, tSkip = 0;
  for (const [token, t] of Object.entries(tokens)) {
    const existing = await db.getIntakeToken(token);
    if (existing) { tSkip++; continue; }
    await db.insertIntakeToken({ token, briefId: t.briefId, venueEmail: t.venueEmail, expiresAt: t.expiresAt });
    if (t.used) await db.markIntakeSubmitted(token);
    if (t.cancelled) await db.cancelIntakeTokensForBrief(t.briefId);
    tCount++;
  }
  console.log(`Intake tokens: ${tCount} migrated, ${tSkip} skipped.\n`);

  // Travel tokens
  const travel = tryRead('.travel-tokens.json') || {};
  let trCount = 0, trSkip = 0;
  for (const [token, t] of Object.entries(travel)) {
    const existing = await db.getTravelToken(token);
    if (existing) { trSkip++; continue; }
    await db.insertTravelToken({ token, briefId: t.briefId, name: t.name, email: t.email, role: t.role || '', expiresAt: t.expiresAt });
    if (t.submitted) await db.markTravelSubmitted(token);
    trCount++;
  }
  console.log(`Travel tokens: ${trCount} migrated, ${trSkip} skipped.\n`);

  // Settings (merge — env vars and DB take precedence on existing fields)
  const settings = tryRead('.settings.json');
  if (settings) {
    const current = await db.getSettings();
    const merged = { ...settings, ...current }; // existing DB values win
    await db.saveSettings(merged);
    console.log('Settings: merged into DB.\n');
  }

  console.log('Migration complete.');
  process.exit(0);
})().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
