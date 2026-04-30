'use strict';
// One-shot: shrink any base64 photos in every brief to 600px JPEG @ q=0.8.

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
  try {
    const out = await sharp(buf).rotate()
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (e) {
    console.warn('  shrink failed:', e.message);
    return dataUrl;
  }
}

async function walk(obj) {
  if (obj == null || typeof obj === 'boolean' || typeof obj === 'number') return obj;
  if (typeof obj === 'string') return shrink(obj);
  if (Array.isArray(obj)) {
    const out = []; for (const v of obj) out.push(await walk(v)); return out;
  }
  if (typeof obj === 'object') {
    const out = {}; for (const k of Object.keys(obj)) out[k] = await walk(obj[k]); return out;
  }
  return obj;
}

(async () => {
  const briefs = await db.listBriefs();
  for (const b of briefs) {
    const before = JSON.stringify(b).length;
    if (before < 1024 * 1024) {
      console.log(`= ${(b.venue?.name || b.id).padEnd(40)} ${(before/1024).toFixed(0)} KB — skipped (already small)`);
      continue;
    }
    const compressed = await walk(b);
    const after = JSON.stringify(compressed).length;
    await db.upsertBrief(compressed);
    console.log(`+ ${(b.venue?.name || b.id).padEnd(40)} ${(before/1024/1024).toFixed(2)} MB → ${(after/1024).toFixed(0)} KB`);
  }
  console.log('\nDone.');
  process.exit(0);
})().catch(err => { console.error('failed:', err); process.exit(1); });
