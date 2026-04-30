'use strict';
// One-shot: shrink any base64 roster photos > 200 KB to 600px JPEG @ q=0.8.
// Safe to re-run; small photos and URL refs are passed through.

require('dotenv').config();
const sharp = require('sharp');
const db = require('./db');

const MAX_DIM = 600;
const QUALITY = 80;

async function shrink(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.length < 200 * 1024) return dataUrl;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return dataUrl;
  const buf = Buffer.from(m[2], 'base64');
  const out = await sharp(buf)
    .rotate() // honour EXIF orientation
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

(async () => {
  const roster = await db.listRoster();
  let touched = 0;
  for (const p of roster) {
    if (typeof p.photo !== 'string' || !p.photo.startsWith('data:image/') || p.photo.length < 200 * 1024) {
      console.log(`= ${p.name.padEnd(20)} (${(p.photo?.length || 0)/1024 | 0} KB) — skipped`);
      continue;
    }
    const before = (p.photo.length / 1024) | 0;
    p.photo = await shrink(p.photo);
    const after = (p.photo.length / 1024) | 0;
    await db.updateRosterPerson(p.id, p);
    touched++;
    console.log(`+ ${p.name.padEnd(20)} ${before} KB → ${after} KB`);
  }
  console.log(`\nDone. ${touched} photos compressed.`);
  process.exit(0);
})().catch(err => {
  console.error('Compression failed:', err);
  process.exit(1);
});
