'use strict';

// Load .env locally; on Vercel env vars are already injected.
try { require('dotenv').config(); } catch (_) {}

const express    = require('express');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const Anthropic  = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const db = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// Merge a venue's intake submission into the brief's structured fields.
// Rule: only fill brief fields that are currently empty/unset — never overwrite
// values the GenX team already entered. Returns the (mutated) brief.
function mergeIntakeIntoBrief(brief, data) {
  if (!brief || !data) return brief;
  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  const fillIfEmpty = (obj, key, val) => {
    if (val === undefined || val === null || val === '') return;
    if (isEmpty(obj[key])) obj[key] = val;
  };
  const fillBoolIfUnset = (obj, key, val) => {
    if (typeof val !== 'boolean') return;
    if (obj[key] === undefined || obj[key] === null) obj[key] = val;
  };
  // Tri-state answers ('yes' | 'no' | 'unknown' | '') — only an explicit yes/no
  // lands in the brief; "unknown"/unanswered leaves the brief field unset so the
  // GenX team can see it still needs confirming. Legacy boolean submissions pass
  // through unchanged.
  const fillTriIfUnset = (obj, key, val) => {
    if (typeof val === 'boolean') return fillBoolIfUnset(obj, key, val);
    if (val !== 'yes' && val !== 'no') return;
    if (obj[key] === undefined || obj[key] === null) obj[key] = (val === 'yes');
  };

  // Venue
  brief.venue ||= {};
  fillIfEmpty(brief.venue, 'name',          data.venueName);
  fillIfEmpty(brief.venue, 'businessName',  data.businessName);
  fillIfEmpty(brief.venue, 'street',        data.venueAddress);
  fillIfEmpty(brief.venue, 'street',        data.venueStreet);
  fillIfEmpty(brief.venue, 'city',          data.venueCity);
  fillIfEmpty(brief.venue, 'state',         data.venueState);
  fillIfEmpty(brief.venue, 'zip',           data.venueZip);
  fillIfEmpty(brief.venue, 'phone',         data.venuePhone);
  fillIfEmpty(brief.venue, 'capacity',      data.venueCapacity);
  fillIfEmpty(brief.venue, 'totalTicketed', data.venueTotalTicketed);
  fillIfEmpty(brief.venue, 'type',          data.venueType);

  // Security Contacts → contacts.primary / contacts.backup
  brief.contacts ||= {};
  brief.contacts.primary ||= {};
  fillIfEmpty(brief.contacts.primary, 'name',  data.secChiefName);
  fillIfEmpty(brief.contacts.primary, 'title', data.secChiefTitle);
  fillIfEmpty(brief.contacts.primary, 'phone', data.secChiefPhone);
  fillIfEmpty(brief.contacts.primary, 'email', data.secChiefEmail);
  brief.contacts.backup ||= {};
  fillIfEmpty(brief.contacts.backup, 'name',  data.facilityName);
  fillIfEmpty(brief.contacts.backup, 'phone', data.facilityPhone);
  fillIfEmpty(brief.contacts.backup, 'email', data.facilityEmail);

  // Ingress
  brief.ingress ||= {};
  fillBoolIfUnset(brief.ingress, 'magnetometer',     data.chkMag);
  fillBoolIfUnset(brief.ingress, 'bagCheck',         data.chkBag);
  fillBoolIfUnset(brief.ingress, 'wand',             data.chkWand);
  fillBoolIfUnset(brief.ingress, 'patDown',          data.chkPatDown);
  fillBoolIfUnset(brief.ingress, 'visualInspection', data.chkVisual);
  fillBoolIfUnset(brief.ingress, 'evolv',            data.chkEvolv);
  fillIfEmpty(brief.ingress, 'ticketingType', data.ticketingType);
  fillIfEmpty(brief.ingress, 'gateCount',     data.gateCount);
  fillIfEmpty(brief.ingress, 'gateOpenTime',  data.gateOpenTime);
  fillIfEmpty(brief.ingress, 'notes',         data.ingressNotes);
  // Prohibited items arrive as free text; the brief stores them as tags
  if (typeof data.prohibitedItems === 'string' && data.prohibitedItems.trim() && isEmpty(brief.ingress.prohibitedItems)) {
    brief.ingress.prohibitedItems = data.prohibitedItems.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 40);
  }

  // Staffing
  brief.staffing ||= {};
  fillIfEmpty(brief.staffing, 'totalSecurity',     data.totalSecurity);
  fillIfEmpty(brief.staffing, 'leo',               data.leoCount);
  fillIfEmpty(brief.staffing, 'backstageSecurity', data.backstageSecurity);
  fillBoolIfUnset(brief.staffing, 'uniformed',     data.uniformed);
  fillIfEmpty(brief.staffing, 'uniformDesc',       data.uniformDesc);
  fillIfEmpty(brief.staffing, 'notes',             data.staffingNotes);

  // Medical
  brief.medical ||= {};
  fillTriIfUnset(brief.medical, 'onSite',          data.medicalOnSite);
  fillIfEmpty(brief.medical, 'firstResponderCount',data.firstResponderCount);
  fillTriIfUnset(brief.medical, 'aedOnSite',       data.aedOnSite);
  fillTriIfUnset(brief.medical, 'aedNearStage',    data.aedNearStage);
  fillIfEmpty(brief.medical, 'firstAidLocations',  data.firstAidLocations);
  fillIfEmpty(brief.medical, 'emergencyProtocol',  data.emergencyProtocol);
  fillIfEmpty(brief.medical, 'announcementMethod', data.announcementMethod);

  // Evacuation
  brief.evacuation ||= {};
  fillIfEmpty(brief.evacuation, 'primaryExit',      data.primaryExit);
  fillIfEmpty(brief.evacuation, 'secondaryExit',    data.secondaryExit);
  fillIfEmpty(brief.evacuation, 'rallyPoint',       data.rallyPoint);
  fillIfEmpty(brief.evacuation, 'lockdownProtocol', data.lockdownProtocol);
  if (typeof data.safeRooms === 'string' && data.safeRooms.trim() && isEmpty(brief.evacuation.safeRooms)) {
    brief.evacuation.safeRooms = data.safeRooms.split('\n').map(s => s.trim()).filter(Boolean);
  }

  // Meet & Greet
  brief.meetgreet ||= {};
  fillIfEmpty(brief.meetgreet, 'protocol',   data.mgProtocol);
  fillIfEmpty(brief.meetgreet, 'giftPolicy', data.giftPolicy);

  // Communications
  brief.communications ||= {};
  fillTriIfUnset(brief.communications, 'venueShareComms',  data.venueShareComms);
  fillIfEmpty(brief.communications, 'securityOps',         data.securityOps);
  fillIfEmpty(brief.communications, 'securityOpsPhone',    data.securityOpsPhone);
  fillTriIfUnset(brief.communications, 'cellOk',           data.cellOk);
  fillIfEmpty(brief.communications, 'notes',               data.commsNotes);

  // Access Control — translate booleans into doorSystems string array
  brief.access ||= {};
  if (isEmpty(brief.access.doorSystems)) {
    const sys = [];
    if (data.doorCardAccess) sys.push('Card Access');
    if (data.doorFacial)     sys.push('Facial Recognition');
    if (data.doorPin)        sys.push('PIN');
    if (data.doorKey)        sys.push('Key');
    if (data.doorFob)        sys.push('Fob');
    if (data.doorOther)      sys.push('Other');
    if (sys.length) brief.access.doorSystems = sys;
  }
  fillIfEmpty(brief.access, 'parkingNotes', data.parkingNotes);

  // Load In / Out
  brief.loadinout ||= {};
  fillIfEmpty(brief.loadinout, 'dockLocation',  data.dockLocation);
  fillIfEmpty(brief.loadinout, 'loadinDate',    data.loadinDate);
  fillIfEmpty(brief.loadinout, 'loadinTime',    data.loadinTime);
  fillIfEmpty(brief.loadinout, 'loadinNotes',   data.loadinNotes);
  fillIfEmpty(brief.loadinout, 'loadoutDate',   data.loadoutDate);
  fillIfEmpty(brief.loadinout, 'loadoutTime',   data.loadoutTime);
  fillIfEmpty(brief.loadinout, 'loadoutNotes',  data.loadoutNotes);
  fillIfEmpty(brief.loadinout, 'vehicleCount',  data.vehicleCount);
  fillTriIfUnset(brief.loadinout, 'securityAtDock', data.securityAtDock);

  // Promoted questionnaire sections — land in real brief fields so the
  // dashboard, printed brief, and AI import all stay aligned.
  fillIfEmpty(brief.venue,    'priorIncidents', data.priorIncidents);
  fillIfEmpty(brief.contacts, 'leOnSite',       data.leOnSite);
  fillIfEmpty(brief.contacts, 'leAgency',       data.leAgency);
  brief.crowd ||= {};
  fillIfEmpty(brief.crowd, 'needed',         data.barricadeNeeded);
  fillIfEmpty(brief.crowd, 'audience',       data.crowdType);
  fillIfEmpty(brief.crowd, 'barricadeType',  data.barricadeType);
  fillIfEmpty(brief.crowd, 'stageBarricade', data.stageBarricade);
  fillIfEmpty(brief.crowd, 'notes',          data.barricadeNotes);
  brief.cctv ||= {};
  fillIfEmpty(brief.cctv, 'coverage',  data.cctvCoverage);
  fillIfEmpty(brief.cctv, 'monitored', data.cctvMonitored);
  fillIfEmpty(brief.cctv, 'notes',     data.cctvNotes);
  fillIfEmpty(brief.medical,        'toGreenRoom',     data.medicalToGreenRoom);
  fillIfEmpty(brief.evacuation,     'weatherPlan',     data.weatherPlan);
  fillIfEmpty(brief.communications, 'opsCenterOnSite', data.opsCenterOnSite);
  fillIfEmpty(brief.access, 'backstageControlled',   data.backstageAccessControlled);
  fillIfEmpty(brief.access, 'castCrewAccess',        data.castCrewAccess);
  fillIfEmpty(brief.access, 'teamArrival',           data.teamCheckIn);
  fillIfEmpty(brief.access, 'additionalCredentials', data.additionalCredentials);
  brief.timeline ||= {};
  fillIfEmpty(brief.timeline, 'mediaDate', data.mediaDayDate);
  brief.mediaDay ||= {};
  fillTriIfUnset(brief.mediaDay, 'scheduled', data.mediaDay);
  fillIfEmpty(brief.mediaDay, 'timeWindow', data.mediaDayTime);
  fillIfEmpty(brief.mediaDay, 'location',   data.mediaLocation);
  fillIfEmpty(brief.mediaDay, 'escort',     data.mediaEscort);
  fillIfEmpty(brief.mediaDay, 'notes',      data.mediaNotes);

  // Maps — append uploaded files as map entries (don't overwrite existing)
  brief.maps ||= [];
  const mapTitles = { mapFloor: 'Floor Plan', mapBackstage: 'Backstage Layout', mapParking: 'Parking / Perimeter' };
  for (const [field, title] of Object.entries(mapTitles)) {
    const img = data[field];
    if (typeof img === 'string' && img.startsWith('data:') && !brief.maps.some(m => m.title === title)) {
      brief.maps.push({ title, description: 'From venue intake', image: img });
    }
  }

  return brief;
}

// Canonical intake field registry — keep in sync with public/intake.html and
// public/intake-blank.html. Used by the AI document-import extraction schema.
const INTAKE_TEXT_FIELDS = [
  // Venue
  'venueName','businessName','venueAddress','venuePhone','venueCapacity','priorIncidents',
  // Security contacts / provider / law enforcement
  'secChiefName','secChiefTitle','secChiefPhone','secChiefEmail',
  'facilityName','facilityPhone','facilityEmail',
  'leAgency',
  // Ingress & screening
  'ticketingType','gateCount','gateOpenTime','prohibitedItems','ingressNotes',
  // Crowd & barricade
  'crowdType','barricadeType','barricadeNotes',
  // CCTV
  'cctvNotes',
  // Staffing
  'totalSecurity','backstageSecurity','uniformDesc','staffingNotes',
  // Medical
  'firstResponderCount','firstAidLocations','emergencyProtocol',
  // Evacuation
  'primaryExit','secondaryExit','safeRooms','rallyPoint','announcementMethod','lockdownProtocol','weatherPlan',
  // Communications
  'securityOps','securityOpsPhone','commsNotes',
  // Access control / team arrival
  'additionalCredentials','castCrewAccess','parkingNotes','teamCheckIn',
  // Load in / out
  'dockLocation','loadinNotes','loadoutNotes',
  // Media day
  'mediaDayDate','mediaDayTime','mediaLocation','mediaNotes'
];
const INTAKE_CHECK_FIELDS = [
  'chkMag','chkBag','chkWand','chkPatDown','chkVisual','chkEvolv','uniformed',
  'doorCardAccess','doorFacial','doorPin','doorKey','doorFob','doorOther'
];
const INTAKE_TRI_FIELDS = [
  'medicalOnSite','aedOnSite','aedNearStage','medicalToGreenRoom',
  'venueShareComms','opsCenterOnSite','cellOk','securityAtDock',
  'barricadeNeeded','stageBarricade','backstageAccessControlled',
  'cctvCoverage','cctvMonitored',
  'leOnSite','mediaDay','mediaEscort'
];

// Append venue-submitted emergency contacts into brief.emergency (dedupe by name/phone)
function mergeEmergencyContacts(brief, contacts) {
  const submitted = (contacts || []).filter(c => c && (c.name || c.phone));
  if (!submitted.length) return;
  if (!Array.isArray(brief.emergency)) brief.emergency = [];
  for (const c of submitted) {
    const dupe = brief.emergency.some(e =>
      (e.name && c.name && e.name.toLowerCase() === c.name.toLowerCase()) ||
      (e.phone && c.phone && e.phone === c.phone)
    );
    if (!dupe) brief.emergency.push({ role: c.role || '', name: c.name || '', phone: c.phone || '', email: c.email || '' });
  }
}

// ── Intake normalization ──────────────────────────────────────────────────────
// Deterministic cleanup of venue-entered answers before they are stored or
// merged into the brief: dates → YYYY-MM-DD, clock times → HH:MM (24h),
// phones → (XXX) XXX-XXXX, emails lowercased, counts stripped of commas,
// whitespace trimmed. Anything that can't be confidently normalized is left
// exactly as typed and reported in `issues` so the team can chase it down.
const INTAKE_NUMERIC_KEYS = new Set([
  'venueCapacity','venueTotalTicketed','gateCount','totalSecurity','backstageSecurity',
  'firstResponderCount','vehicleCount','leoCount','mgGenxStaff'
]);
// Keys ending in "Time" that are durations/windows, not clock times
const INTAKE_TIME_EXEMPT = new Set(['mediaDayTime','leResponseTime']);

function normalizeDateStr(s) {
  const pad = n => String(n).padStart(2, '0');
  const mk = (y, mo, d) => {
    y = +y; mo = +mo; d = +d;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  };
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);          // 2026-07-29
  if (m) return mk(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}(?:\d{2})?)$/);    // 7-29-26 / 07/29/2026
  if (m) return mk(m[3], m[1], m[2]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{2}|\d{4})$/); // July 29, 2026
  if (m) {
    const mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
      .indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (mo) return mk(m[3], mo, m[2]);
  }
  return null;
}

function normalizeTimeStr(s) {
  const str = s.trim().toLowerCase();
  let m = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/);   // 5pm, 5:30 pm
  if (m) {
    let h = +m[1]; const min = m[2] || '00';
    if (h < 1 || h > 12 || +min > 59) return null;
    const pm = m[3].startsWith('p');
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + min;
  }
  m = str.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);                          // 17:00
  if (m) return m[1].padStart(2, '0') + ':' + m[2];
  m = str.match(/^([01]\d|2[0-3])([0-5]\d)$/);                            // 1700
  if (m) return m[1] + ':' + m[2];
  return null;
}

function normalizePhoneStr(s) {
  const ext = (s.match(/(?:ext|extension|x)\.?\s*(\d{1,6})\s*$/i) || [])[1];
  let digits = s.replace(/\D/g, '');
  if (ext) digits = digits.slice(0, digits.length - ext.length);
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` + (ext ? ` ext. ${ext}` : '');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeIntakeData(data) {
  const issues = [];
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (typeof v !== 'string') { out[k] = v; continue; }
    let val = v.trim();
    if (val && !val.startsWith('data:')) {
      if (/Date$/.test(k)) {
        const d = normalizeDateStr(val);
        if (d) val = d;
        else if (!/^(n\/?a|none|tbd)$/i.test(val))
          issues.push({ field: k, value: val, problem: 'Date could not be read — expected something like 7/29/2026' });
      } else if (/Phone$/.test(k)) {
        const p = normalizePhoneStr(val);
        if (p) val = p;
        else if (val.replace(/\D/g, '').length > 0)
          issues.push({ field: k, value: val, problem: 'Phone number looks incomplete or malformed' });
      } else if (/Email$/.test(k)) {
        val = val.toLowerCase();
        if (!EMAIL_RE.test(val))
          issues.push({ field: k, value: val, problem: 'Not a valid email address' });
      } else if (INTAKE_NUMERIC_KEYS.has(k)) {
        const cleaned = val.replace(/[,\s]/g, '');
        if (/^\d+$/.test(cleaned)) val = cleaned;
        else if (!/\d/.test(val) && !/^(n\/?a|none|tbd|unknown)$/i.test(val))
          issues.push({ field: k, value: val, problem: 'Expected a number' });
      } else if (/Time$/.test(k) && !INTAKE_TIME_EXEMPT.has(k)) {
        const t = normalizeTimeStr(val);
        if (t) val = t;
        // "TBD" / "after doors" are legitimate answers — no flag
      }
    }
    out[k] = val;
  }
  if (Array.isArray(data?.emergencyContacts)) {
    out.emergencyContacts = data.emergencyContacts.map(c => {
      if (!c || typeof c !== 'object') return c;
      const nc = { ...c };
      for (const f of ['role', 'name', 'phone', 'email']) {
        if (typeof nc[f] === 'string') nc[f] = nc[f].trim();
      }
      if (nc.phone) {
        const p = normalizePhoneStr(nc.phone);
        if (p) nc.phone = p;
        else if (!/^[2-9]11$/.test(nc.phone.trim()) && nc.phone.replace(/\D/g, '').length > 0)
          issues.push({ field: 'emergencyContacts', value: nc.phone, problem: `Phone for "${nc.name || nc.role || 'contact'}" looks incomplete` });
      }
      if (nc.email) {
        nc.email = nc.email.toLowerCase();
        if (!EMAIL_RE.test(nc.email))
          issues.push({ field: 'emergencyContacts', value: nc.email, problem: `Email for "${nc.name || nc.role || 'contact'}" is not valid` });
      }
      return nc;
    });
  }
  return { data: out, issues };
}

// JSON schema for structured extraction of a completed questionnaire document.
function intakeExtractionSchema() {
  const nul = { type: 'null' };
  const props = {};
  for (const f of INTAKE_TEXT_FIELDS)  props[f] = { anyOf: [{ type: 'string' }, nul] };
  for (const f of INTAKE_CHECK_FIELDS) props[f] = { anyOf: [{ type: 'boolean' }, nul] };
  for (const f of INTAKE_TRI_FIELDS)   props[f] = { anyOf: [{ type: 'string', enum: ['yes', 'no', 'unknown'] }, nul] };
  const contactStr = { anyOf: [{ type: 'string' }, nul] };
  props.emergencyContacts = {
    anyOf: [{
      type: 'array',
      items: {
        type: 'object',
        properties: { role: contactStr, name: contactStr, phone: contactStr, email: contactStr },
        required: ['role', 'name', 'phone', 'email'],
        additionalProperties: false
      }
    }, nul]
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

function computeIntakeExpiry(brief) {
  const showDate = brief?.timeline?.showDate;
  const fallback = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (!showDate) return fallback.toISOString();
  const fiveBefore = new Date(showDate + 'T23:59:59');
  fiveBefore.setDate(fiveBefore.getDate() - 5);
  if (fiveBefore.getTime() <= Date.now()) return fallback.toISOString();
  return fiveBefore.toISOString();
}

function resolveAppUrl(req) {
  if (settings.appUrl) return settings.appUrl.replace(/\/$/, '');
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (req) {
    const host = req.get('host');
    if (host && !/^localhost(:|$)/i.test(host)) {
      return `${req.protocol}://${host}`;
    }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${PORT}`;
}

// Trust X-Forwarded-* from one proxy hop (Vercel, Cloudflare, etc.) so req.secure
// reflects the real client→proxy scheme.
app.set('trust proxy', 1);

// Public token-form limits: travel submissions are text-only and stay tiny; intake
// submissions carry client-compressed map/EAP attachments as base64, so they get
// room up to Vercel's serverless body ceiling (~4.5MB). Authenticated brief PUTs
// can carry base64 photos, so the global limit is higher.
app.use((req, res, next) => {
  const len = Number(req.headers['content-length'] || 0);
  let limit = 25 * 1024 * 1024;
  if (/^\/api\/travel\//.test(req.path)) limit = 512 * 1024;
  else if (/^\/api\/intake\//.test(req.path)) limit = Math.floor(4.2 * 1024 * 1024);
  if (len > limit) return res.status(413).json({ error: 'Payload too large' });
  next();
});
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// CSRF defence-in-depth: block state-changing /api/* requests whose Origin/Referer
// (when present) doesn't match this host. Public token routes are exempt because
// they're meant to be hit from venue/talent inboxes that may rewrite the referer.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (/^\/api\/(intake|travel)\//.test(req.path)) return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    const u = new URL(origin);
    if (u.host === req.headers.host) return next();
  } catch (_) { /* malformed header → block */ }
  return res.status(403).json({ error: 'Cross-origin request blocked' });
});
// Run schema bootstrap + settings load before any /api request is served.
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  try { await ensureInit(); next(); }
  catch (err) { console.error('init failed:', err); res.status(500).json({ error: 'Server initialising' }); }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use(cookieParser());

// ── Settings cache (single source of truth lives in Postgres) ────────────────
// Settings are read from DB on cold start and after every write. Treat reads
// as best-effort cached; writes always hit the DB and refresh the cache.
const SETTINGS_DEFAULTS = {
  anthropicKey: '',
  orgName: 'GenX Takeover Security',
  orgContact: '', orgEmail: '', orgPhone: '',
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  smtpFrom: '', smtpFromName: 'GenX Takeover Security',
  notifyEmail: '', appUrl: process.env.APP_URL || '',
  emailSubject: '', emailIntro: '', emailInstructions: '',
  travelContacts: [],
  credDefaults: { name: '', issuedBy: '', notes: '' }
};
let settings = { ...SETTINGS_DEFAULTS };

async function refreshSettings() {
  const stored = await db.getSettings();
  settings = { ...SETTINGS_DEFAULTS, ...stored };
  // Env var always wins over DB so a leaked DB row can't override the live key.
  if (process.env.ANTHROPIC_API_KEY) settings.anthropicKey = process.env.ANTHROPIC_API_KEY;
}

async function saveSettings() {
  // Strip computed/env-overridden fields before persisting (env var always wins on read).
  const toStore = { ...settings };
  await db.saveSettings(toStore);
}

// ── Init / cold-start bootstrap ───────────────────────────────────────────────
// Memoised so it runs once per Node process (or once per Vercel cold start).
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) {
    _initPromise = (async () => {
      await db.initSchema();
      await refreshSettings();
      const dropped = (await db.sweepStaleIntakeTokens()) + (await db.sweepStaleTravelTokens());
      if (dropped) console.log(`Swept ${dropped} stale tokens.`);
    })().catch(err => {
      _initPromise = null; // allow retry on next request
      throw err;
    });
  }
  return _initPromise;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET environment variable is required in production. Refusing to start.');
    process.exit(1);
  }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('⚠️  SESSION_SECRET not set — using ephemeral random secret. All sessions will invalidate on restart. Set SESSION_SECRET in your environment to persist sessions.');
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return { hash, salt };
}
function checkPassword(password, hash, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex') === hash;
}
function createToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })).toString('base64');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (_) { return null; }
}
async function requirePortalAuth(req, res, next) {
  try {
    const token = req.cookies?.gxs || req.headers['x-gxs-token'];
    const data = verifyToken(token);
    if (!data) return res.status(401).json({ error: 'Not authenticated' });
    const user = await db.getUserById(data.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.portalUser = user;
    next();
  } catch (err) { next(err); }
}
function requireAdmin(req, res, next) {
  requirePortalAuth(req, res, () => {
    if (req.portalUser.role !== 'security') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// Escape user-supplied values before embedding in HTML (e.g., outbound emails) to prevent injection.
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Bound untrusted public form payloads so a single field/array can't blow up memory or storage.
function sanitiseFormBody(value, depth = 0) {
  const MAX_STR = 5000;
  const MAX_ARR = 100;
  const MAX_KEYS = 200;
  const MAX_DEPTH = 4;
  if (depth > MAX_DEPTH) return null;
  if (value == null) return value;
  if (typeof value === 'string') {
    // Base64 file attachments (maps, EAP) are legitimately huge — capping them at
    // MAX_STR silently corrupts the data URI. The route-level body limit already
    // bounds total size; here just guard against absurd single values.
    const cap = value.startsWith('data:') ? 4.2 * 1024 * 1024 : MAX_STR;
    return value.length > cap ? value.slice(0, cap) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_ARR).map(v => sanitiseFormBody(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (n++ >= MAX_KEYS) break;
      if (typeof k !== 'string' || k.length > 100) continue;
      out[k] = sanitiseFormBody(v, depth + 1);
    }
    return out;
  }
  return null;
}

// Reject id/token params that look unsafe — long, non-alphanumeric, or prototype keys.
// This prevents prototype-pollution writes on the token stores (which are plain objects).
function isSafeIdParam(s) {
  return typeof s === 'string'
    && s.length > 0 && s.length <= 64
    && /^[a-zA-Z0-9_-]+$/.test(s)
    && s !== '__proto__' && s !== 'constructor' && s !== 'prototype';
}
app.param('id', (req, res, next, val) => {
  if (!isSafeIdParam(val)) return res.status(400).json({ error: 'Invalid id' });
  next();
});
app.param('token', (req, res, next, val) => {
  if (!isSafeIdParam(val)) return res.status(400).json({ error: 'Invalid token' });
  next();
});


// ── National crime baseline (FBI UCR 2022) ────────────────────────────────────
const NATIONAL_2022 = {
  population: 333287557,
  violentRate: 369.7, propertyRate: 1948.8,
  homicideRate: 6.3,  robberyRate: 55.0,
  assaultRate: 264.9, burglaryRate: 268.5,
  larcenyRate: 1384.8, mvrRate: 300.5
};

// ── State crime baseline (FBI UCR 2022, rates per 100k) — used as guaranteed fallback ──
const STATE_CRIME_2022 = {
  AL:{violentRate:559,propertyRate:2619,homicideRate:12.9,robberyRate:73,assaultRate:422,burglaryRate:479,larcenyRate:1715,mvrRate:425},
  AK:{violentRate:829,propertyRate:2804,homicideRate:8.2,robberyRate:73,assaultRate:694,burglaryRate:351,larcenyRate:2151,mvrRate:302},
  AZ:{violentRate:453,propertyRate:3146,homicideRate:7.5,robberyRate:67,assaultRate:320,burglaryRate:337,larcenyRate:2237,mvrRate:572},
  AR:{violentRate:599,propertyRate:2844,homicideRate:11.4,robberyRate:71,assaultRate:468,burglaryRate:530,larcenyRate:1997,mvrRate:317},
  CA:{violentRate:500,propertyRate:2607,homicideRate:7.2,robberyRate:103,assaultRate:340,burglaryRate:377,larcenyRate:1620,mvrRate:610},
  CO:{violentRate:394,propertyRate:2982,homicideRate:5.6,robberyRate:48,assaultRate:302,burglaryRate:312,larcenyRate:2011,mvrRate:659},
  CT:{violentRate:199,propertyRate:1470,homicideRate:3.9,robberyRate:47,assaultRate:131,burglaryRate:214,larcenyRate:1112,mvrRate:144},
  DE:{violentRate:499,propertyRate:2379,homicideRate:7.9,robberyRate:87,assaultRate:369,burglaryRate:290,larcenyRate:1806,mvrRate:283},
  FL:{violentRate:378,propertyRate:2394,homicideRate:7.3,robberyRate:66,assaultRate:274,burglaryRate:356,larcenyRate:1724,mvrRate:314},
  GA:{violentRate:375,propertyRate:2432,homicideRate:9.1,robberyRate:71,assaultRate:256,burglaryRate:418,larcenyRate:1689,mvrRate:325},
  HI:{violentRate:268,propertyRate:2564,homicideRate:3.0,robberyRate:44,assaultRate:195,burglaryRate:283,larcenyRate:2056,mvrRate:225},
  ID:{violentRate:247,propertyRate:1900,homicideRate:2.7,robberyRate:16,assaultRate:202,burglaryRate:221,larcenyRate:1501,mvrRate:178},
  IL:{violentRate:428,propertyRate:1946,homicideRate:10.8,robberyRate:103,assaultRate:292,burglaryRate:265,larcenyRate:1311,mvrRate:370},
  IN:{violentRate:419,propertyRate:2221,homicideRate:8.6,robberyRate:69,assaultRate:311,burglaryRate:335,larcenyRate:1656,mvrRate:230},
  IA:{violentRate:273,propertyRate:1880,homicideRate:4.1,robberyRate:39,assaultRate:207,burglaryRate:236,larcenyRate:1486,mvrRate:158},
  KS:{violentRate:434,propertyRate:2483,homicideRate:5.9,robberyRate:55,assaultRate:344,burglaryRate:345,larcenyRate:1877,mvrRate:261},
  KY:{violentRate:242,propertyRate:2007,homicideRate:7.5,robberyRate:49,assaultRate:174,burglaryRate:344,larcenyRate:1468,mvrRate:195},
  LA:{violentRate:625,propertyRate:2748,homicideRate:18.3,robberyRate:120,assaultRate:461,burglaryRate:494,larcenyRate:1914,mvrRate:340},
  ME:{violentRate:142,propertyRate:1449,homicideRate:1.6,robberyRate:15,assaultRate:112,burglaryRate:162,larcenyRate:1201,mvrRate:86},
  MD:{violentRate:462,propertyRate:2000,homicideRate:9.7,robberyRate:122,assaultRate:303,burglaryRate:267,larcenyRate:1447,mvrRate:286},
  MA:{violentRate:381,propertyRate:1666,homicideRate:3.4,robberyRate:89,assaultRate:271,burglaryRate:231,larcenyRate:1265,mvrRate:170},
  MI:{violentRate:428,propertyRate:1870,homicideRate:7.4,robberyRate:87,assaultRate:309,burglaryRate:297,larcenyRate:1347,mvrRate:226},
  MN:{violentRate:291,propertyRate:2179,homicideRate:4.2,robberyRate:61,assaultRate:206,burglaryRate:242,larcenyRate:1649,mvrRate:288},
  MS:{violentRate:311,propertyRate:2395,homicideRate:12.9,robberyRate:56,assaultRate:218,burglaryRate:547,larcenyRate:1618,mvrRate:230},
  MO:{violentRate:522,propertyRate:2686,homicideRate:13.3,robberyRate:90,assaultRate:393,burglaryRate:428,larcenyRate:1937,mvrRate:321},
  MT:{violentRate:498,propertyRate:2729,homicideRate:4.0,robberyRate:18,assaultRate:429,burglaryRate:234,larcenyRate:2256,mvrRate:239},
  NE:{violentRate:294,propertyRate:2156,homicideRate:4.6,robberyRate:52,assaultRate:215,burglaryRate:237,larcenyRate:1697,mvrRate:222},
  NV:{violentRate:519,propertyRate:2859,homicideRate:7.8,robberyRate:130,assaultRate:349,burglaryRate:369,larcenyRate:1932,mvrRate:558},
  NH:{violentRate:201,propertyRate:1297,homicideRate:1.6,robberyRate:27,assaultRate:156,burglaryRate:143,larcenyRate:1070,mvrRate:84},
  NJ:{violentRate:248,propertyRate:1385,homicideRate:4.6,robberyRate:76,assaultRate:151,burglaryRate:179,larcenyRate:943,mvrRate:263},
  NM:{violentRate:898,propertyRate:3788,homicideRate:11.5,robberyRate:80,assaultRate:761,burglaryRate:542,larcenyRate:2532,mvrRate:714},
  NY:{violentRate:350,propertyRate:1529,homicideRate:5.1,robberyRate:84,assaultRate:237,burglaryRate:188,larcenyRate:1135,mvrRate:206},
  NC:{violentRate:381,propertyRate:2343,homicideRate:9.1,robberyRate:67,assaultRate:275,burglaryRate:349,larcenyRate:1743,mvrRate:251},
  ND:{violentRate:328,propertyRate:2168,homicideRate:3.5,robberyRate:18,assaultRate:274,burglaryRate:162,larcenyRate:1836,mvrRate:170},
  OH:{violentRate:354,propertyRate:2070,homicideRate:7.0,robberyRate:69,assaultRate:258,burglaryRate:316,larcenyRate:1541,mvrRate:213},
  OK:{violentRate:583,propertyRate:3163,homicideRate:9.7,robberyRate:57,assaultRate:471,burglaryRate:596,larcenyRate:2127,mvrRate:440},
  OR:{violentRate:286,propertyRate:2897,homicideRate:4.2,robberyRate:65,assaultRate:203,burglaryRate:316,larcenyRate:2044,mvrRate:537},
  PA:{violentRate:311,propertyRate:1598,homicideRate:8.3,robberyRate:81,assaultRate:207,burglaryRate:215,larcenyRate:1193,mvrRate:190},
  RI:{violentRate:284,propertyRate:1650,homicideRate:3.2,robberyRate:60,assaultRate:207,burglaryRate:195,larcenyRate:1329,mvrRate:126},
  SC:{violentRate:588,propertyRate:2877,homicideRate:11.6,robberyRate:84,assaultRate:447,burglaryRate:453,larcenyRate:2055,mvrRate:369},
  SD:{violentRate:430,propertyRate:1928,homicideRate:4.3,robberyRate:20,assaultRate:386,burglaryRate:162,larcenyRate:1588,mvrRate:178},
  TN:{violentRate:698,propertyRate:2997,homicideRate:11.9,robberyRate:107,assaultRate:543,burglaryRate:532,larcenyRate:2124,mvrRate:341},
  TX:{violentRate:433,propertyRate:2820,homicideRate:8.1,robberyRate:83,assaultRate:306,burglaryRate:375,larcenyRate:1972,mvrRate:473},
  UT:{violentRate:239,propertyRate:2565,homicideRate:2.6,robberyRate:30,assaultRate:186,burglaryRate:270,larcenyRate:1888,mvrRate:407},
  VT:{violentRate:257,propertyRate:1552,homicideRate:2.1,robberyRate:11,assaultRate:208,burglaryRate:175,larcenyRate:1280,mvrRate:97},
  VA:{violentRate:215,propertyRate:1640,homicideRate:7.2,robberyRate:54,assaultRate:130,burglaryRate:177,larcenyRate:1341,mvrRate:122},
  WA:{violentRate:345,propertyRate:3438,homicideRate:5.0,robberyRate:59,assaultRate:263,burglaryRate:327,larcenyRate:2522,mvrRate:589},
  WV:{violentRate:372,propertyRate:1871,homicideRate:7.7,robberyRate:31,assaultRate:301,burglaryRate:381,larcenyRate:1363,mvrRate:127},
  WI:{violentRate:345,propertyRate:1868,homicideRate:6.2,robberyRate:57,assaultRate:256,burglaryRate:231,larcenyRate:1446,mvrRate:191},
  WY:{violentRate:234,propertyRate:1987,homicideRate:2.7,robberyRate:9,assaultRate:188,burglaryRate:199,larcenyRate:1618,mvrRate:170},
  DC:{violentRate:1087,propertyRate:3936,homicideRate:34.0,robberyRate:365,assaultRate:620,burglaryRate:335,larcenyRate:2993,mvrRate:608}
};

// ── Timed fetch helper (AbortController + clearTimeout so no dangling timers) ──
function timedFetch(url, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

// ── Venue crime data helper ───────────────────────────────────────────────────
async function fetchVenueCrimeData(city, state, street) {
  const FBI = 'iiHnOKfno2Mgkt5AyoMe9a5cJ5bYTQCeEtBXMOqO';
  const stateAbbr = (state || '').trim().toUpperCase();
  const result = { national: NATIONAL_2022, state: null, city: null, census: null, crimeIndexScore: null, crimeIndexLabel: null };
  if (!stateAbbr) return result;

  // 1 — State-level FBI data
  try {
    const r = await timedFetch(`https://api.usa.gov/crime/fbi/sapi/api/estimates/states/${stateAbbr}/2022/2022?api_key=${FBI}`);
    const rText = await r.text(); // always drain body
    if (r.ok) {
      const sd = (JSON.parse(rText)).results?.[0];
      if (sd?.population) {
        const p = sd.population;
        const rates = (n) => n ? +(n / p * 1e5).toFixed(1) : null;
        result.state = {
          population: p,
          violentCrime: sd.violent_crime, propertyCrime: sd.property_crime,
          homicide: sd.homicide, robbery: sd.robbery,
          aggravatedAssault: sd.aggravated_assault, burglary: sd.burglary,
          larceny: sd.larceny, motorVehicleTheft: sd.motor_vehicle_theft,
          violentRate: rates(sd.violent_crime), propertyRate: rates(sd.property_crime),
          homicideRate: rates(sd.homicide), robberyRate: rates(sd.robbery),
          assaultRate: rates(sd.aggravated_assault), burglaryRate: rates(sd.burglary),
          larcenyRate: rates(sd.larceny), mvrRate: rates(sd.motor_vehicle_theft)
        };
      }
    }
  } catch (err) { console.warn('FBI state crime API failed:', err.message); }

  // Fallback: if state API failed or returned no rates, use embedded UCR 2022 data
  if (!result.state?.violentRate && STATE_CRIME_2022[stateAbbr]) {
    result.state = { ...STATE_CRIME_2022[stateAbbr], source: 'embedded_ucr_2022' };
  }

  // 2 — City-level FBI data via agency lookup
  try {
    const ar = await timedFetch(`https://api.usa.gov/crime/fbi/sapi/api/agencies/byStateAbbr/${stateAbbr}?api_key=${FBI}`);
    const arText = await ar.text(); // always drain
    if (ar.ok) {
      const amap = JSON.parse(arText);
      const agencies = Array.isArray(amap) ? amap : Object.values(amap.results || amap);
      const cityNorm = (city || '').trim().toLowerCase();
      const found = agencies.find(a => (a.city_name || '').toLowerCase() === cityNorm && (a.agency_type_name || '').toLowerCase().includes('city'))
                 || agencies.find(a => (a.city_name || '').toLowerCase() === cityNorm);
      if (found?.ori) {
        const or = await timedFetch(`https://api.usa.gov/crime/fbi/sapi/api/summarized/agencies/${found.ori}/offenses/2022/2022?api_key=${FBI}`);
        const orText = await or.text(); // always drain
        if (or.ok) {
          const offJson = JSON.parse(orText);
          const offArr = offJson.data || offJson.results || (Array.isArray(offJson) ? offJson : []);
          const om = {};
          offArr.forEach(o => {
            const k = (o.offense || '').toLowerCase().replace(/-/g, '_');
            om[k] = o.actual || 0;
          });
          const pop = found.population || found.nibrs_population || 0;
          if (pop > 0) {
            const violent = om.violent_crime || (om.homicide||0) + (om.robbery||0) + (om.aggravated_assault||0);
            const property = om.property_crime || (om.burglary||0) + (om.larceny||0) + (om.motor_vehicle_theft||0);
            const rates = (n) => n > 0 ? +(n / pop * 1e5).toFixed(1) : null;
            result.city = {
              agencyName: found.agency_name || `${city} Police Department`,
              ori: found.ori, population: pop,
              violentCrime: violent, propertyCrime: property,
              homicide: om.homicide||0, robbery: om.robbery||0,
              aggravatedAssault: om.aggravated_assault||0, burglary: om.burglary||0,
              larceny: om.larceny||0, motorVehicleTheft: om.motor_vehicle_theft||0,
              violentRate: rates(violent), propertyRate: rates(property),
              homicideRate: rates(om.homicide), robberyRate: rates(om.robbery),
              assaultRate: rates(om.aggravated_assault), burglaryRate: rates(om.burglary),
              larcenyRate: rates(om.larceny), mvrRate: rates(om.motor_vehicle_theft)
            };
          }
        }
      }
    }
  } catch (err) { console.warn('FBI city crime API failed:', err.message); }

  // 3 — Census ACS data
  try {
    const geoUrl = `https://geocoding.geo.census.gov/geocoder/geographies/address?street=${encodeURIComponent(street || '')}&city=${encodeURIComponent(city || '')}&state=${stateAbbr}&benchmark=Public_AR_Current&vintage=Current_Current&layers=86&format=json`;
    const gr = await timedFetch(geoUrl);
    const grText = await gr.text(); // always drain
    if (gr.ok) {
      const gj = JSON.parse(grText);
      const match = gj.result?.addressMatches?.[0];
      const ip = match?.geographies?.['Incorporated Places']?.[0];
      if (ip?.STATE && ip?.PLACE) {
        const acsUrl = `https://api.census.gov/data/2022/acs/acs5?get=NAME,B19013_001E,B17001_002E,B01003_001E,B01002_001E&for=place:${ip.PLACE}&in=state:${ip.STATE}`;
        const cr = await timedFetch(acsUrl);
        const crText = await cr.text(); // always drain
        if (cr.ok) {
          const cd = JSON.parse(crText);
          if (cd.length >= 2) {
            const h = cd[0], v = cd[1];
            const get = (k) => v[h.indexOf(k)];
            const totalPop = parseInt(get('B01003_001E')) || 0;
            const poverty  = parseInt(get('B17001_002E')) || 0;
            result.census = {
              placeName: get('NAME'),
              medianHouseholdIncome: parseInt(get('B19013_001E')) || null,
              totalPopulation: totalPop,
              medianAge: parseFloat(get('B01002_001E')) || null,
              povertyRate: totalPop > 0 ? +((poverty / totalPop) * 100).toFixed(1) : null
            };
          }
        }
      }
    }
  } catch (err) { console.warn('Census ACS API failed:', err.message); }

  // 4 — Compute CAP-style crime index (100 = national average)
  const base = result.city || result.state;
  if (base?.violentRate || base?.propertyRate) {
    const vM = base.violentRate ? base.violentRate / NATIONAL_2022.violentRate : 1;
    const pM = base.propertyRate ? base.propertyRate / NATIONAL_2022.propertyRate : 1;
    const score = Math.min(Math.round((vM * 0.6 + pM * 0.4) * 100), 2000);
    result.crimeIndexScore = score;
    result.crimeIndexLabel = score < 100 ? 'Below Average' : score < 200 ? 'Moderate' :
                             score < 400 ? 'Mildly Elevated' : score < 800 ? 'Moderately Elevated' : 'Substantially Elevated';
    result.dataSource = result.city ? 'city' : 'state';
  }

  return result;
}

// ── Multer ───────────────────────────────────────────────────────────────────
// Generic upload (badges, maps, etc.) — images + PDFs (maps can be floor plans).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Only images and PDFs are allowed'), ok);
  }
});
// Photo library — images only.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  }
});

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/debug', requireAdmin, async (req, res, next) => {
  try {
    const allBriefs = await db.listBriefs();
    res.json({
      briefCount: allBriefs.length,
      briefIds: allBriefs.map(b => b.id),
      VERCEL_ENV: process.env.VERCEL || null,
      hasDb: !!process.env.DATABASE_URL,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      hasAnthropicKey: !!settings.anthropicKey
    });
  } catch (err) { next(err); }
});

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await db.getUserByEmail(email.trim());
    if (!user || !checkPassword(password, user.passwordHash, user.passwordSalt)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = createToken(user.id);
    res.cookie('gxs', token, { httpOnly: true, secure: req.secure || !!process.env.VERCEL, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('gxs');
  res.json({ ok: true });
});

app.get('/api/auth/me', requirePortalAuth, (req, res) => {
  const u = req.portalUser;
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, briefId: u.briefId });
});

// ── Portal routes (for logged-in team members) ────────────────────────────────
// Talent/Crew see only finalized briefs (drafts are admin work-in-progress).
// Security sees everything regardless of status.
app.get('/api/portal/brief', requirePortalAuth, async (req, res, next) => {
  try {
    const user = req.portalUser;
    const isAdmin = user.role === 'security';
    let brief = null;
    if (user.briefId) {
      brief = await db.getBrief(user.briefId);
      if (brief && !isAdmin && brief.status !== 'finalized') brief = null;
    } else {
      const all = await db.listBriefs();
      const visible = isAdmin ? all : all.filter(b => b.status === 'finalized');
      // Sort by updatedAt desc so the latest finalized is returned for talent/crew
      visible.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      brief = visible[0] || null;
    }
    if (!brief) return res.status(404).json({ error: 'No brief available yet — check back once a plan is published.' });
    res.json(brief);
  } catch (err) { next(err); }
});

app.get('/api/portal/briefs', requirePortalAuth, async (req, res, next) => {
  try {
    const user = req.portalUser;
    const isAdmin = user.role === 'security';
    let list = [];
    if (user.briefId) {
      const b = await db.getBrief(user.briefId);
      if (b && (isAdmin || b.status === 'finalized')) list = [b];
    } else {
      list = await db.listBriefs();
      if (!isAdmin) list = list.filter(b => b.status === 'finalized');
    }
    res.json(list.map(b => ({ id: b.id, venueName: b.venue?.name, city: b.venue?.city, state: b.venue?.state, showDate: b.timeline?.showDate, status: b.status })));
  } catch (err) { next(err); }
});

// ── Admin: User management ────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, async (req, res, next) => {
  try { res.json(await db.listUsers()); } catch (err) { next(err); }
});

app.post('/api/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, password, role, briefId } = req.body || {};
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });
    if (await db.emailExists(email)) return res.status(409).json({ error: 'Email already exists' });
    const id = uuidv4();
    const { hash, salt } = hashPassword(password);
    await db.insertUser({ id, name, email, role, briefId: briefId || null, passwordHash: hash, passwordSalt: salt });
    res.status(201).json({ id, name, email, role });
  } catch (err) { next(err); }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const { name, email, role, briefId, password } = req.body || {};
    const patch = {};
    if (name)            patch.name = name;
    if (email)           patch.email = email;
    if (role)            patch.role = role;
    if (briefId !== undefined) patch.briefId = briefId || null;
    if (password) { const { hash, salt } = hashPassword(password); patch.passwordHash = hash; patch.passwordSalt = salt; }
    await db.updateUser(req.params.id, patch);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/briefs', requireAdmin, async (req, res, next) => {
  try {
    const all = await db.listBriefs();
    res.json(all.map(b => ({
      id:        b.id,
      venueName: b.venue?.name || 'Untitled Brief',
      city:      b.venue?.city || '',
      state:     b.venue?.state || '',
      showDate:  b.timeline?.showDate || '',
      talent:        (b.talent || []).length,
      crew:          (b.crew || []).length,
      genxSecurity:  (b.genxstaff || []).length,
      status:        b.status || 'draft',
      updatedAt:     b.updatedAt,
      createdAt:     b.createdAt,
      intakeStatus:  b.venueIntake?.status || null,
      intakeEmail:   b.venueIntake?.venueEmail || null,
      intakeSentAt:  b.venueIntake?.sentAt || null,
      intakeDoneAt:  b.venueIntake?.submittedAt || null,
      riskScore:     b.riskAssessment?.overallScore ?? null,
      riskLevel:     b.riskAssessment?.riskLevel || null,
      riskGeneratedAt: b.riskAssessment?.generatedAt || null
    })));
  } catch (err) { next(err); }
});

app.post('/api/briefs', requireAdmin, async (req, res, next) => {
  try {
    const id  = uuidv4();
    const now = new Date().toISOString();
    const body = { ...req.body };
    // Seed GenX credential fields from saved defaults
    const cd = settings.credDefaults || {};
    body.access = body.access || {};
    body.access.genxCred = body.access.genxCred || {};
    if (!body.access.genxCred.name)     body.access.genxCred.name     = cd.name     || '';
    if (!body.access.genxCred.issuedBy) body.access.genxCred.issuedBy = cd.issuedBy || '';
    if (!body.access.genxCred.notes)    body.access.genxCred.notes    = cd.notes    || '';
    await db.upsertBrief({ id, createdAt: now, updatedAt: now, ...body });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// Read-access for any authenticated user; talent/crew can only see finalized briefs
// they're assigned to (or any finalized if their account isn't pinned to one).
app.get('/api/briefs/:id', requirePortalAuth, async (req, res, next) => {
  try {
    const b = await db.getBrief(req.params.id);
    if (!b) return res.status(404).json({ error: 'Not found' });
    if (req.portalUser.role !== 'security') {
      if (b.status !== 'finalized') return res.status(403).json({ error: 'This brief has not been published yet.' });
      if (req.portalUser.briefId && req.portalUser.briefId !== b.id) return res.status(403).json({ error: 'Not assigned to this brief.' });
    }
    res.json(b);
  } catch (err) { next(err); }
});

app.put('/api/briefs/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await db.getBrief(req.params.id) || { id: req.params.id, createdAt: new Date().toISOString() };
    const updated = { ...existing, ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
    await db.upsertBrief(updated);

    // Persist GenX credential fields as org-wide defaults (only overwrite when non-empty)
    const gc = updated.access?.genxCred;
    if (gc) {
      const cur = settings.credDefaults || { name: '', issuedBy: '', notes: '' };
      const next = { ...cur };
      if (gc.name     && gc.name     !== cur.name)     next.name     = gc.name;
      if (gc.issuedBy && gc.issuedBy !== cur.issuedBy) next.issuedBy = gc.issuedBy;
      if (gc.notes    && gc.notes    !== cur.notes)    next.notes    = gc.notes;
      if (next.name !== cur.name || next.issuedBy !== cur.issuedBy || next.notes !== cur.notes) {
        settings.credDefaults = next;
        saveSettings().catch(err => console.error('[credDefaults] save failed', err));
      }
    }

    res.json({ ok: true, updatedAt: updated.updatedAt });
  } catch (err) { next(err); }
});

app.delete('/api/briefs/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.deleteBrief(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PIN-gated full API key reveal. PIN is admin-shoulder-surf gate; auth still required.
const KEY_VIEW_PIN = process.env.KEY_VIEW_PIN || '1300';
app.post('/api/settings/reveal-key', requireAdmin, (req, res) => {
  const { pin } = req.body || {};
  if (!pin || String(pin) !== KEY_VIEW_PIN) return res.status(403).json({ error: 'Invalid PIN' });
  if (!settings.anthropicKey) return res.status(404).json({ error: 'No key configured' });
  res.json({ key: settings.anthropicKey });
});

// ── Settings routes ───────────────────────────────────────────────────────────
app.get('/api/settings', requireAdmin, (req, res) => {
  const maskedKey  = settings.anthropicKey ? 'sk-ant-....' + settings.anthropicKey.slice(-6) : '';
  const maskedPass = settings.smtpPass ? '••••••••' : '';
  res.json({
    ...settings,
    anthropicKey: maskedKey,
    hasKey: !!settings.anthropicKey,
    smtpPass: maskedPass,
    hasSmtp: !!(settings.smtpHost && settings.smtpUser && settings.smtpPass)
  });
});

app.put('/api/settings', requireAdmin, async (req, res, next) => {
  try {
    const { anthropicKey, orgName, orgContact, orgEmail, orgPhone,
            smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, smtpFromName,
            notifyEmail, appUrl,
            emailSubject, emailIntro, emailInstructions } = req.body;
    if (anthropicKey !== undefined && !anthropicKey.startsWith('sk-ant-....')) settings.anthropicKey = anthropicKey;
    if (orgName      !== undefined) settings.orgName      = orgName;
    if (orgContact   !== undefined) settings.orgContact   = orgContact;
    if (orgEmail     !== undefined) settings.orgEmail     = orgEmail;
    if (orgPhone     !== undefined) settings.orgPhone     = orgPhone;
    if (smtpHost     !== undefined) settings.smtpHost     = smtpHost;
    if (smtpPort     !== undefined) settings.smtpPort     = smtpPort;
    if (smtpUser     !== undefined) settings.smtpUser     = smtpUser;
    if (smtpPass !== undefined && smtpPass !== '••••••••') settings.smtpPass = smtpPass;
    if (smtpFrom     !== undefined) settings.smtpFrom     = smtpFrom;
    if (smtpFromName !== undefined) settings.smtpFromName = smtpFromName;
    if (notifyEmail        !== undefined) settings.notifyEmail        = notifyEmail;
    if (appUrl             !== undefined) settings.appUrl             = appUrl;
    if (emailSubject       !== undefined) settings.emailSubject       = emailSubject;
    if (emailIntro         !== undefined) settings.emailIntro         = emailIntro;
    if (emailInstructions  !== undefined) settings.emailInstructions  = emailInstructions;
    if (Array.isArray(req.body.travelContacts)) settings.travelContacts = req.body.travelContacts;
    await saveSettings();
    res.json({ ok: true, hasKey: !!settings.anthropicKey, hasSmtp: !!(settings.smtpHost && settings.smtpUser && settings.smtpPass) });
  } catch (err) { next(err); }
});

// ── ROS Template ─────────────────────────────────────────────────────────────
app.get('/api/ros-template', requireAdmin, (req, res) => {
  res.json(settings.rosTemplate || []);
});
app.put('/api/ros-template', requireAdmin, async (req, res, next) => {
  try {
    const rows = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected array' });
    settings.rosTemplate = rows;
    await saveSettings();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Risk Assessment ───────────────────────────────────────────────────────────
app.get('/api/risk/:id', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    if (!brief.riskAssessment) return res.status(404).json({ error: 'No saved assessment' });
    res.json(brief.riskAssessment);
  } catch (err) { next(err); }
});

app.post('/api/risk/:id', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!settings.anthropicKey) return res.status(400).json({ error: 'No API key configured. Add your Anthropic key in Settings.' });

  try {
    // Fetch crime data with an overall hard timeout so no AbortSignal timers linger
    const crimeData = await Promise.race([
      fetchVenueCrimeData(brief.venue?.city || '', brief.venue?.state || '', brief.venue?.street || ''),
      new Promise(resolve => setTimeout(() => resolve({ national: NATIONAL_2022, state: null, city: null, census: null, crimeIndexScore: null, crimeIndexLabel: null }), 25000))
    ]);
    // Small delay to let any pending network timers fully clear before opening Anthropic connection
    await new Promise(r => setTimeout(r, 500));

    // Build a clean brief summary (strip base64 images to keep prompt small)
    const briefSummary = JSON.parse(JSON.stringify(brief));
    if (briefSummary.talent) briefSummary.talent.forEach(t => { t.photo = t.photo ? '[photo uploaded]' : null; });
    if (briefSummary.crew) briefSummary.crew.forEach(c => { c.photo = c.photo ? '[photo uploaded]' : null; });
    if (briefSummary.maps) briefSummary.maps.forEach(m => { m.image = m.image ? '[image uploaded]' : null; });
    if (briefSummary.badgeImages) briefSummary.badgeImages = briefSummary.badgeImages.map(() => '[badge image]');

    // Summarize crime context for AI prompt (no raw arrays, keep it tight)
    const crimeContext = crimeData.city || crimeData.state;
    const crimePromptSection = crimeContext ? `
CRIME DATA FOR ${brief.venue?.city || brief.venue?.state} (rates per 100k population, 2022):
Violent Crime: ${crimeContext.violentRate ?? 'N/A'} (national avg: ${NATIONAL_2022.violentRate})
Property Crime: ${crimeContext.propertyRate ?? 'N/A'} (national avg: ${NATIONAL_2022.propertyRate})
Homicide: ${crimeContext.homicideRate ?? 'N/A'} (national avg: ${NATIONAL_2022.homicideRate})
Robbery: ${crimeContext.robberyRate ?? 'N/A'} (national avg: ${NATIONAL_2022.robberyRate})
Aggravated Assault: ${crimeContext.assaultRate ?? 'N/A'} (national avg: ${NATIONAL_2022.assaultRate})
Burglary: ${crimeContext.burglaryRate ?? 'N/A'} (national avg: ${NATIONAL_2022.burglaryRate})
Motor Vehicle Theft: ${crimeContext.mvrRate ?? 'N/A'} (national avg: ${NATIONAL_2022.mvrRate})
Crime Index Score: ${crimeData.crimeIndexScore ?? 'N/A'} (100 = national average)
${crimeData.census ? `Median Household Income: $${crimeData.census.medianHouseholdIncome?.toLocaleString() || 'N/A'} | Poverty Rate: ${crimeData.census.povertyRate ?? 'N/A'}%` : ''}
Data source: ${crimeData.dataSource === 'city' ? (crimeContext.agencyName || 'City PD') : 'State estimates'}` : '';

    const prompt = `You are a senior event security consultant and insurance risk advisor preparing a pre-event risk assessment that will be read by the security director, the show's producers, and the show's insurance broker/underwriter.

DEPTH REQUIREMENTS — this assessment must be specific to THIS event, not generic:
- Every finding must cite concrete data from the brief: actual attendance figures, staff counts, post assignments, gate/entrance counts, call times, venue name, city, named personnel roles. Never write advice that could apply to any event.
- Show your math. When you assess staffing, compute the actual ratio (e.g., "14 guards for 3,200 attendees = 1:229, versus the ASIS ESP-2012 benchmark of 1:250 for seated shows / 1:100 for GA floor"). Do the same for ingress throughput (attendees per screening lane per hour), medical coverage, and AED counts.
- Recommendations must be actionable with quantities and deadlines ("add 4 screeners to the north gate to hit 900/hr throughput before doors at 18:00"), not vague ("improve screening").
- If the brief is MISSING data needed to assess a category (e.g., no evacuation plan, no medical staffing listed, no radio channel plan), that gap is itself a finding — call it out explicitly and score the category down for it. Missing information is a real risk and an underwriting red flag.
- detail fields should be 3-5 sentences with the supporting numbers; do not pad, but do not produce one-line summaries either.

VENUE CONTEXT CALIBRATION — be reasonable about what the venue itself already provides:
Before scoring anything, classify the venue type from the brief (name, address, description) and factor in the security infrastructure that type of venue inherently brings. Different venues are NOT blank slates:
- High-baseline venues (casinos, arenas/stadiums with house security, cruise ships, hotels/resorts, theme parks): these come with 24/7 surveillance rooms, in-house security staff, controlled/hardened entrances, established emergency plans, on-site medical, and often armed security or resident law enforcement. Do NOT flag gaps the venue's own infrastructure clearly covers — a casino show does not need the production to bring its own camera coverage or perimeter hardening. Focus findings on what the PRODUCTION must add on top (backstage/talent protection, credentialing, coordination with house security, ingress for the show's own ticketed crowd).
- Medium-baseline venues (theaters, convention centers, clubs, school/church facilities): some house staff and infrastructure, but the production carries much of the load. Assess the split explicitly.
- Low/no-baseline venues (rodeo grounds, fairgrounds, open fields, parking lots, ranches, street festivals, temporary outdoor stages): assume NOTHING exists unless the brief says so — no cameras, no house security, no fixed perimeter, no medical, poor lighting, soft vehicle access. The production's plan must cover everything, so raise the bar accordingly and flag exposures a permanent venue would have handled (perimeter/fencing, lighting, vehicle mitigation, weather shelter, dust/livestock hazards where relevant).
State your venue classification and its assumed baseline in the relevant findings so the reader can see the calibration. Apply the same logic to the insurance section — an underwriter prices a casino ballroom very differently from an open-air rodeo arena (weather exposure, livestock, temporary structures, unfenced perimeters all change coverage needs).

INDUSTRY STANDARDS FRAMEWORK:
Base all findings and recommendations on these authoritative sources (cite the most relevant one per finding):
- ASIS International Event Security Guidelines (ASIS ESP-2012): crowd management, staffing ratios, access control, threat assessment
- ASIS/ANSI Physical Asset Protection Standard (PAP-2012): perimeter security, credential systems, access control protocols
- ASIS General Security Risk Assessment Guideline (GSRA-2003): risk scoring methodology, vulnerability assessment
- NFPA 101 Life Safety Code: evacuation routes, occupant capacity, exit requirements
- NFPA 3000 (Standard for Active Shooter/Hostile Event Response): lockdown protocols, emergency communications
- DHS Best Practices for Crowd Management: ingress screening, crowd density, behavioral detection
- AHA/ARC AED Placement Guidelines: 1 AED per 1,000 attendees, maximum 3-minute response time
- OSHA 1910.151 Medical Services & First Aid: minimum first responder requirements for crowd events
- NIMS/ICS Emergency Management Framework: command structure, communications protocols

INSURANCE ANALYSIS:
The production takes out insurance for each show. Analyze this brief the way an event-insurance underwriter would, and produce the "insurance" section of the output:
- recommendedCoverages: the specific policies this event should carry, with realistic limits for its size/type — Commercial General Liability (typical event minimums $1M per occurrence / $2M aggregate; scale up for attendance, pyro, or vehicle exposure), liquor liability or host liquor (only if alcohol is served/sold), workers' compensation for paid staff, hired & non-owned auto (if crew/talent transport or shuttle ops appear in the brief), event cancellation/postponement, equipment/inland marine for production gear, excess/umbrella when attendance or exposures warrant, and terrorism (TRIA) or weather riders where the profile justifies them. Tie every rationale to facts in the brief.
- underwritingConcerns: conditions in this brief that an underwriter would flag — things that raise premiums, trigger exclusions, or could void coverage (e.g., no documented evacuation plan, understaffed medical, pyrotechnics, crowd-surfing/GA floor without barricade plan, elevated local crime, unvetted vendors, no incident-reporting procedure). For each: what the insurer sees, the likely impact on coverage/premium, and the mitigation that fixes it.
- documentationChecklist: paperwork the show should have in hand before doors — certificates of insurance (COIs) from every vendor and subcontractor with the production named as additional insured, waiver of subrogation where appropriate, signed venue agreement with clear indemnification, security vendor's own GL/workers' comp certs, incident report forms, and any permits (pyro, alcohol, occupancy).
- readinessScore: 0-100 for how insurable/well-documented this event currently looks; summary: 2-3 sentences an underwriter would write about this event.
This is operational risk guidance, not legal or brokerage advice — phrase recommendations as items to confirm with the show's licensed broker.

BRIEF DATA:
${JSON.stringify(briefSummary, null, 2)}
${briefSummary.venue?.totalTicketed ? `TOTAL TICKETED ATTENDANCE: ${briefSummary.venue.totalTicketed} (use this for all staffing ratio calculations, crowd density, and ingress throughput analysis)` : ''}
${crimePromptSection}`;

    const riskSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'riskLevel', 'categoryScores', 'criticalFindings', 'mediumFindings', 'lowFindings', 'passingChecks', 'priorityActions', 'crimeSummary', 'insurance'],
      properties: {
        overallScore: { type: 'integer', description: '0-100 overall risk-readiness score (higher = safer)' },
        riskLevel: { type: 'string', enum: ['Low', 'Medium', 'High', 'Critical'] },
        categoryScores: {
          type: 'object',
          additionalProperties: false,
          required: ['staffing', 'medical', 'evacuation', 'accessControl', 'communications', 'ingress'],
          properties: {
            staffing: { type: 'integer' }, medical: { type: 'integer' }, evacuation: { type: 'integer' },
            accessControl: { type: 'integer' }, communications: { type: 'integer' }, ingress: { type: 'integer' }
          }
        },
        criticalFindings: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['title', 'detail', 'recommendation', 'standard'],
            properties: { title: { type: 'string' }, detail: { type: 'string' }, recommendation: { type: 'string' }, standard: { type: 'string' } }
          }
        },
        mediumFindings: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['title', 'detail', 'recommendation', 'standard'],
            properties: { title: { type: 'string' }, detail: { type: 'string' }, recommendation: { type: 'string' }, standard: { type: 'string' } }
          }
        },
        lowFindings: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['title', 'detail', 'standard'],
            properties: { title: { type: 'string' }, detail: { type: 'string' }, standard: { type: 'string' } }
          }
        },
        passingChecks: { type: 'array', items: { type: 'string' } },
        priorityActions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['action', 'severity'],
            properties: { action: { type: 'string' }, severity: { type: 'string', enum: ['Critical', 'Medium', 'Low'] } }
          }
        },
        crimeSummary: { type: 'string', description: '3-4 sentence analysis of venue area crime context vs national averages' },
        insurance: {
          type: 'object',
          additionalProperties: false,
          required: ['readinessScore', 'summary', 'recommendedCoverages', 'underwritingConcerns', 'documentationChecklist'],
          properties: {
            readinessScore: { type: 'integer', description: '0-100 insurability/documentation readiness' },
            summary: { type: 'string' },
            recommendedCoverages: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['coverage', 'recommendedLimit', 'priority', 'rationale'],
                properties: {
                  coverage: { type: 'string' },
                  recommendedLimit: { type: 'string' },
                  priority: { type: 'string', enum: ['Essential', 'Recommended', 'Optional'] },
                  rationale: { type: 'string' }
                }
              }
            },
            underwritingConcerns: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['title', 'detail', 'impact', 'mitigation'],
                properties: { title: { type: 'string' }, detail: { type: 'string' }, impact: { type: 'string' }, mitigation: { type: 'string' } }
              }
            },
            documentationChecklist: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['item', 'detail'],
                properties: { item: { type: 'string' }, detail: { type: 'string' } }
              }
            }
          }
        }
      }
    };

    const client = new Anthropic({ apiKey: settings.anthropicKey });
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: riskSchema } },
      messages: [{ role: 'user', content: prompt }]
    });
    if (msg.stop_reason === 'refusal') {
      throw new Error('The AI declined to analyze this brief. Try regenerating, or edit the brief and try again.');
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new Error('The assessment was too long to complete. Try regenerating.');
    }
    // Thinking blocks may precede the text block — find the text block explicitly
    let content = (msg.content || []).find(b => b.type === 'text')?.text || '';
    // Strip markdown code fences if present (defensive; structured output should be bare JSON)
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const assessment = JSON.parse(content);
    assessment.generatedAt = new Date().toISOString();
    assessment.briefId = req.params.id;
    assessment.venueName = brief.venue?.name || 'Unknown Venue';
    assessment.venueCity = brief.venue?.city || '';
    assessment.venueState = brief.venue?.state || '';
    assessment.eventDate = brief.timeline?.showDate || '';

    // Attach the full crime intelligence data for the UI
    assessment.crimeIndex = {
      score: crimeData.crimeIndexScore,
      label: crimeData.crimeIndexLabel,
      dataSource: crimeData.dataSource,
      city: crimeData.city,
      state: crimeData.state,
      national: crimeData.national,
      census: crimeData.census,
      venueState: brief.venue?.state || ''
    };

    // Save assessment to brief so it can be loaded without regenerating
    brief.riskAssessment = assessment;
    await db.upsertBrief(brief);

    res.json(assessment);
  } catch (err) {
    console.error('Risk assessment error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate assessment' });
  }
});

app.post('/api/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const b64  = req.file.buffer.toString('base64');
  const mime = req.file.mimetype;
  res.json({ url: `data:${mime};base64,${b64}` });
});

// ── Photo Library ─────────────────────────────────────────────────────────────
// Photos are stored as data: URLs in Postgres. Could later move to Vercel Blob.
app.get('/api/photos', requireAdmin, async (req, res, next) => {
  try { res.json(await db.listPhotos()); } catch (err) { next(err); }
});

app.post('/api/photos', requireAdmin, photoUpload.array('files', 100), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });
    const added = req.files.map(f => ({
      id: uuidv4(),
      name: f.originalname,
      url: `data:${f.mimetype};base64,${f.buffer.toString('base64')}`,
      addedAt: new Date().toISOString()
    }));
    await db.insertPhotos(added);
    res.json({ added: added.length, photos: added });
  } catch (err) { next(err); }
});

app.delete('/api/photos/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.deletePhoto(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Email helpers ─────────────────────────────────────────────────────────────
function makeTransporter() {
  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: parseInt(settings.smtpPort) || 587,
    secure: parseInt(settings.smtpPort) === 465,
    auth: { user: settings.smtpUser, pass: settings.smtpPass }
  });
}

function fromAddress() {
  return `"${settings.smtpFromName || settings.orgName}" <${settings.smtpFrom || settings.smtpUser}>`;
}

function venueIntakeEmailHtml(intakeUrl, brief, expiresAt) {
  const event = brief.venue?.name || 'your venue';
  const date  = brief.timeline?.showDate ? new Date(brief.timeline.showDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : '';
  const exp   = new Date(expiresAt).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
  const org   = settings.orgName || 'GenX Takeover Security';

  // Templates are admin-controlled but venue/event names come from brief data — escape before substitution.
  const orgEsc   = escapeHtml(org);
  const eventEsc = escapeHtml(event);
  const dateEsc  = escapeHtml(date);
  const expEsc   = escapeHtml(exp);
  const urlEsc   = escapeHtml(intakeUrl);

  const introText = escapeHtml(settings.emailIntro || `You are receiving this email from the ${org} security team. We have been contracted to provide security services for the upcoming event at [Venue]${date ? ' on [Date]' : ''}.

As part of our pre-event planning process, we ask that your venue security team complete the attached questionnaire. The information you provide allows us to coordinate effectively with your staff, align on protocols, and build a comprehensive security brief prior to the event.`)
    .replace(/\[Org\]/g, orgEsc)
    .replace(/\[Venue\]/g, `<strong style="color:#e6edf3;">${eventEsc}</strong>`)
    .replace(/\[Date\]/g, dateEsc ? `<strong style="color:#e6edf3;">${dateEsc}</strong>` : '');

  const instructionsText = escapeHtml(settings.emailInstructions || 'Please fill out as much as you can — not every field will apply to your venue, and nothing is required. You can save your progress at any time and return to the link to continue — your answers will be restored automatically. Once complete, click Submit and our team will be notified immediately. A completed copy of the security brief will be provided to your team as well.')
    .replace(/\[Org\]/g, orgEsc)
    .replace(/\[Venue\]/g, eventEsc)
    .replace(/\[Date\]/g, dateEsc);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0d1117;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #30363d;overflow:hidden;">
<tr><td style="background:#e63946;padding:24px 32px;">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.7);">${orgEsc}</p>
  <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;color:#fff;">Venue Security Questionnaire</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#e6edf3;">Hello,</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#8b949e;white-space:pre-wrap;">${introText}</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#8b949e;">${instructionsText}</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
    <a href="${urlEsc}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Complete Questionnaire →</a>
  </td></tr></table>
  <p style="margin:0 0 8px;font-size:13px;color:#8b949e;">Or copy this link into your browser:</p>
  <p style="margin:0 0 24px;font-size:12px;color:#58a6ff;word-break:break-all;">${urlEsc}</p>
  <table width="100%" cellpadding="12" cellspacing="0" style="background:#0d1117;border-radius:8px;border:1px solid #30363d;margin-bottom:24px;">
    <tr><td style="font-size:12px;color:#8b949e;line-height:1.8;">
      <strong style="color:#e6edf3;">Important:</strong> This link is valid until <strong style="color:#e6edf3;">${expEsc}</strong> and can only be used once. Once you submit, access to the questionnaire will close automatically.<br><br>
      If you have any questions or need to reach our team directly, please reply to this email.
    </td></tr>
  </table>
  <p style="margin:0 0 4px;font-size:13px;color:#e6edf3;font-weight:600;">Thank you for your cooperation.</p>
  <p style="margin:0;font-size:12px;color:#484f58;">— ${orgEsc} Operations</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function intakeNotificationEmailHtml(brief, token, briefUrl, data) {
  const venue = escapeHtml(brief?.venue?.name || token.venueName || 'Unknown Venue');
  const date  = escapeHtml(brief?.timeline?.showDate || '');
  const url   = escapeHtml(briefUrl);
  const rows  = Object.entries(data || {}).map(([k, v]) => {
    const label = escapeHtml(String(k).replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()));
    const value = escapeHtml(String(v == null ? '' : v).slice(0, 200));
    return `<tr><td style="padding:6px 8px;font-size:12px;color:#8b949e;white-space:nowrap;border-bottom:1px solid #21262d;">${label}</td><td style="padding:6px 8px;font-size:12px;color:#e6edf3;border-bottom:1px solid #21262d;">${value}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0d1117;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #30363d;overflow:hidden;">
<tr><td style="background:#238636;padding:20px 32px;">
  <h1 style="margin:0;font-size:18px;font-weight:800;color:#fff;">Venue Intake Completed</h1>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#e6edf3;">${venue}</p>
  ${date ? `<p style="margin:0 0 20px;font-size:13px;color:#8b949e;">Show date: ${date}</p>` : '<p style="margin:0 0 20px;"></p>'}
  <p style="margin:0 0 16px;font-size:14px;color:#8b949e;">The venue has submitted their questionnaire. Review the responses below, then open the brief to make your updates.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;border-radius:8px;border:1px solid #30363d;margin-bottom:24px;">
    <tr style="background:#161b22;"><th style="padding:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8b949e;text-align:left;border-bottom:1px solid #30363d;">Field</th><th style="padding:8px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#8b949e;text-align:left;border-bottom:1px solid #30363d;">Response</th></tr>
    ${rows}
  </table>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 8px;">
    <a href="${url}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;">Open Brief & Apply Updates</a>
  </td></tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Test email route ──────────────────────────────────────────────────────────
app.post('/api/settings/test-email', requireAdmin, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to is required' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    return res.status(400).json({ error: 'SMTP not configured' });
  }
  try {
    await makeTransporter().sendMail({
      from: fromAddress(),
      to,
      subject: `Test Email — ${settings.orgName || 'GenX Takeover Security'}`,
      html: `<div style="font-family:sans-serif;padding:24px;background:#0d1117;color:#e6edf3;border-radius:8px;">
        <h2 style="color:#3fb950;">✓ Email is working!</h2>
        <p style="color:#8b949e;">Your SMTP configuration is set up correctly. Venue intake emails will send successfully.</p>
        <p style="color:#484f58;font-size:12px;">— ${escapeHtml(settings.orgName || 'GenX Takeover Security')}</p>
      </div>`
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Venue Intake routes ───────────────────────────────────────────────────────

// Send intake link to venue contact
app.post('/api/briefs/:id/send-venue-intake', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  const { venueEmail } = req.body;
  if (!venueEmail) return res.status(400).json({ error: 'venueEmail is required' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    return res.status(400).json({ error: 'Email not configured. Add SMTP settings in Settings.' });
  }

  await db.cancelIntakeTokensForBrief(req.params.id);

  const token     = uuidv4();
  const expiresAt = computeIntakeExpiry(brief);
  await db.insertIntakeToken({ token, briefId: req.params.id, venueEmail, expiresAt });

  brief.venueIntake = { status: 'pending', sentAt: new Date().toISOString(), venueEmail };
  await db.upsertBrief(brief);

  const appUrl    = resolveAppUrl(req);
  const intakeUrl = `${appUrl}/intake/${token}`;

  try {
    await makeTransporter().sendMail({
      from: fromAddress(),
      to: venueEmail,
      subject: (settings.emailSubject || 'Venue Security Questionnaire — [Event Name]')
        .replace(/\[Event Name\]/g, brief.venue?.name || 'Security Brief')
        .replace(/\[Venue\]/g, brief.venue?.name || 'Security Brief')
        .replace(/\[Date\]/g, brief.timeline?.showDate || ''),
      html: venueIntakeEmailHtml(intakeUrl, brief, expiresAt)
    });
    res.json({ ok: true, expiresAt, intakeUrl });
  } catch (err) {
    await db.deleteIntakeToken(token);
    brief.venueIntake = null;
    await db.upsertBrief(brief);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// Venue fetches intake form data
app.get('/api/intake/:token', async (req, res, next) => {
  try {
    const t = await db.getIntakeToken(req.params.token);
    if (!t || t.cancelled)                    return res.status(410).json({ error: 'This link is no longer valid.' });
    if (t.used)                               return res.status(410).json({ error: 'This questionnaire has already been submitted. Thank you!' });
    if (new Date(t.expiresAt) < new Date())   return res.status(410).json({ error: 'This link has expired. Please contact the security company.' });
    const brief = await db.getBrief(t.briefId);
    res.json({
      venueName:  brief?.venue?.name   || '',
      venueStreet:brief?.venue?.street || '',
      venueCity:  brief?.venue?.city   || '',
      venueState: brief?.venue?.state  || '',
      venueZip:   brief?.venue?.zip    || '',
      eventDate:  brief?.timeline?.showDate || '',
      orgName:    settings.orgName || 'GenX Takeover Security',
      orgContact: settings.orgContact || '',
      orgEmail:   settings.orgEmail   || '',
      orgPhone:   settings.orgPhone   || '',
      expiresAt:  t.expiresAt
    });
  } catch (err) { next(err); }
});

// Venue submits intake form
app.post('/api/intake/:token', async (req, res, next) => {
  try {
  const t = await db.getIntakeToken(req.params.token);
  if (!t || t.cancelled)                    return res.status(410).json({ error: 'This link is no longer valid.' });
  if (t.used)                               return res.status(410).json({ error: 'Already submitted.' });
  if (new Date(t.expiresAt) < new Date())   return res.status(410).json({ error: 'Link expired.' });

  const { data, issues } = normalizeIntakeData(sanitiseFormBody(req.body) || {});

  await db.markIntakeSubmitted(req.params.token);
  t.submittedAt = new Date().toISOString();

  const brief = await db.getBrief(t.briefId);
  if (brief) {
    brief.venueIntake = {
      status: 'completed',
      submittedAt: t.submittedAt,
      venueEmail: t.venueEmail,
      sentAt: brief.venueIntake?.sentAt,
      data,
      issues
    };

    // Merge structured intake answers into matching brief sections
    // (only fills empty fields — never overwrites GenX-entered values)
    mergeIntakeIntoBrief(brief, data);

    // Merge submitted emergency contacts into brief.emergency (append, dedupe)
    mergeEmergencyContacts(brief, data.emergencyContacts);

    await db.upsertBrief(brief);
  }

  // Notify Steve
  const notifyTo = settings.notifyEmail || settings.orgEmail;
  if (notifyTo && settings.smtpHost && settings.smtpUser && settings.smtpPass) {
    const appUrl   = resolveAppUrl(req);
    const briefUrl = `${appUrl}/brief?id=${t.briefId}`;
    try {
      await makeTransporter().sendMail({
        from: fromAddress(),
        to: notifyTo,
        subject: `Venue Intake Completed — ${brief?.venue?.name || t.venueEmail}`,
        html: intakeNotificationEmailHtml(brief, t, briefUrl, data)
      });
    } catch (err) { console.error('Intake notification email failed:', err.message); }
  }

  // Optional courtesy receipt to the venue submitter
  const copyTo = (data.sendCopyEmail || '').toString().trim();
  if (copyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(copyTo) && settings.smtpHost && settings.smtpUser && settings.smtpPass) {
    try {
      const orgName = settings.orgName || 'GenX Takeover Security';
      const venueName = brief?.venue?.name || 'your venue';
      await makeTransporter().sendMail({
        from: fromAddress(),
        to: copyTo,
        subject: `Receipt — Venue Security Questionnaire (${venueName})`,
        html: `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;">
          <div style="max-width:560px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;">
            <h2 style="margin:0 0 12px;font-size:18px;">Submission received</h2>
            <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#8b949e;">
              Thank you for completing the venue security questionnaire for <strong style="color:#e6edf3;">${(venueName || '').replace(/[<>&]/g,'')}</strong>.
              Your responses have been delivered to the ${orgName.replace(/[<>&]/g,'')} team and will be reviewed by personnel directly assigned to this event.
            </p>
            <p style="margin:0;font-size:12px;color:#484f58;">If you need to amend any answers, reply to this email and we'll re-issue an editable link.</p>
          </div>
        </div>`
      });
    } catch (err) { console.error('Venue receipt email failed:', err.message); }
  }

  res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Travel Questionnaire routes ───────────────────────────────────────────────

// Send travel questionnaire to selected contacts
app.post('/api/briefs/:id/send-travel-questionnaire', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass)
    return res.status(400).json({ error: 'Email not configured. Add SMTP settings in Settings.' });

  const { contacts } = req.body; // array of { name, email, role }
  if (!Array.isArray(contacts) || contacts.length === 0)
    return res.status(400).json({ error: 'No contacts provided.' });

  const appUrl   = resolveAppUrl(req);
  const venueName = brief.venue?.name || 'the upcoming show';
  const showDate  = brief.timeline?.showDate || '';
  const org       = settings.orgName || 'GenX Takeover Security';
  const sent = [];
  const failed = [];

  for (const contact of contacts) {
    if (!contact.email) continue;
    await db.cancelTravelTokensFor(req.params.id, contact.email);
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    await db.insertTravelToken({ token, briefId: req.params.id, name: contact.name, email: contact.email, role: contact.role || '', expiresAt });
    const formUrl = `${appUrl}/travel/${token}`;
    const dateStr = showDate ? new Date(showDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : '';
    const orgEsc       = escapeHtml(org);
    const venueEsc     = escapeHtml(venueName);
    const nameEsc      = escapeHtml(contact.name || 'there');
    const dateEsc      = escapeHtml(dateStr);
    const formUrlEsc   = escapeHtml(formUrl);
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0d1117;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #30363d;overflow:hidden;">
<tr><td style="background:#58a6ff;padding:24px 32px;">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.8);">${orgEsc}</p>
  <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;color:#fff;">Travel Info Request ✈️</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#e6edf3;">Hi ${nameEsc},</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#8b949e;">We're coordinating travel for <strong style="color:#e6edf3;">${venueEsc}</strong>${dateEsc ? ` on <strong style="color:#e6edf3;">${dateEsc}</strong>` : ''}. Please fill out your flight details so we can build the travel brief and coordinate pickups.</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
    <a href="${formUrlEsc}" style="display:inline-block;background:#58a6ff;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Enter My Travel Info →</a>
  </td></tr></table>
  <p style="margin:0 0 8px;font-size:13px;color:#8b949e;">Or copy this link:</p>
  <p style="margin:0 0 24px;font-size:12px;color:#58a6ff;word-break:break-all;">${formUrlEsc}</p>
  <p style="margin:0;font-size:12px;color:#484f58;">— ${orgEsc} Travel Coordination</p>
</td></tr>
</table></td></tr></table></body></html>`;

    try {
      await makeTransporter().sendMail({
        from: fromAddress(), to: contact.email,
        subject: `Travel Info Needed — ${venueName}${dateStr ? ' · ' + dateStr : ''}`,
        html
      });
      sent.push(contact.email);
    } catch (err) {
      await db.deleteTravelToken(token);
      failed.push({ email: contact.email, error: err.message });
    }
  }

  // Store send record on brief
  if (!brief.travel) brief.travel = {};
  if (!brief.travel.questionnaires) brief.travel.questionnaires = [];
  brief.travel.questionnaires.push({ sentAt: new Date().toISOString(), contacts: contacts.map(c => c.email), sent, failed });
  await db.upsertBrief(brief);

  res.json({ ok: true, sent, failed });
});

// Traveler fetches their form context
app.get('/api/travel/:token', async (req, res, next) => {
  try {
    const t = await db.getTravelToken(req.params.token);
    if (!t || t.cancelled) return res.status(410).json({ error: 'This link is no longer valid.' });
    if (t.submitted)       return res.status(410).json({ error: 'You already submitted your travel info. Thank you!' });
    if (new Date(t.expiresAt) < new Date()) return res.status(410).json({ error: 'This link has expired. Please contact the team.' });
    const brief = await db.getBrief(t.briefId);
    res.json({
      name: t.name || '', role: t.role || '',
      venueName: brief?.venue?.name || '', venueCity: brief?.venue?.city || '', venueState: brief?.venue?.state || '',
      showDate: brief?.timeline?.showDate || '', hotelName: brief?.hotel?.name || '',
      checkin: brief?.hotel?.checkin || '', checkout: brief?.hotel?.checkout || '',
      orgName: settings.orgName || 'GenX Takeover Security',
      expiresAt: t.expiresAt
    });
  } catch (err) { next(err); }
});

// Traveler submits their travel info
app.post('/api/travel/:token', async (req, res, next) => {
  try {
  const t = await db.getTravelToken(req.params.token);
  if (!t || t.cancelled) return res.status(410).json({ error: 'This link is no longer valid.' });
  if (t.submitted)       return res.status(410).json({ error: 'Already submitted.' });
  if (new Date(t.expiresAt) < new Date()) return res.status(410).json({ error: 'Link expired.' });

  const data = sanitiseFormBody(req.body) || {};

  await db.markTravelSubmitted(req.params.token);
  t.submittedAt = new Date().toISOString();

  const brief = await db.getBrief(t.briefId);
  if (brief) {
    if (!brief.travel) brief.travel = {};
    if (!brief.travel.responses) brief.travel.responses = [];
    // Replace if already responded (edge case)
    const existing = brief.travel.responses.findIndex(r => r.email === t.email);
    const record = { name: t.name, email: t.email, role: t.role, submittedAt: t.submittedAt, token: req.params.token, ...data };
    if (existing >= 0) brief.travel.responses[existing] = record;
    else brief.travel.responses.push(record);
    await db.upsertBrief(brief);
  }

  // Notify admin
  const notifyTo = settings.notifyEmail || settings.orgEmail;
  if (notifyTo && settings.smtpHost && settings.smtpUser && settings.smtpPass) {
    try {
      const whoEsc   = escapeHtml(t.name || t.email);
      const roleEsc  = escapeHtml(t.role || 'Unknown role');
      const venEsc   = escapeHtml(brief?.venue?.name || 'Unknown Venue');
      const rowsHtml = Object.entries(data).map(([k,v]) => {
        const labelEsc = escapeHtml(String(k).replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()));
        const valEsc   = escapeHtml(String(v == null ? '' : v));
        return `<tr><td style="padding:6px 8px;color:#8b949e;font-size:12px;border-bottom:1px solid #21262d;">${labelEsc}</td><td style="padding:6px 8px;color:#e6edf3;font-size:12px;border-bottom:1px solid #21262d;">${valEsc}</td></tr>`;
      }).join('');
      await makeTransporter().sendMail({
        from: fromAddress(), to: notifyTo,
        subject: `Travel Response — ${t.name || t.email} · ${brief?.venue?.name || 'Unknown Venue'}`,
        html: `<div style="font-family:sans-serif;padding:24px;background:#0d1117;color:#e6edf3;border-radius:8px;">
          <h2 style="color:#58a6ff;">✈️ Travel Info Submitted</h2>
          <p style="color:#8b949e;"><strong style="color:#e6edf3;">${whoEsc}</strong> (${roleEsc}) submitted their travel info for <strong style="color:#e6edf3;">${venEsc}</strong>.</p>
          <table style="border-collapse:collapse;width:100%;margin-top:16px;">${rowsHtml}</table>
        </div>`
      });
    } catch (err) { console.warn('Travel notification email failed:', err.message); }
  }

  res.json({ ok: true });
  } catch (err) { next(err); }
});

// Get travel responses for a brief
app.get('/api/briefs/:id/travel', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const pendingRows = await db.listPendingTravelForBrief(req.params.id);
    const pending = pendingRows.map(t => ({ name: t.name, email: t.email, role: t.role, status: 'pending', sentAt: t.createdAt }));
    res.json({ responses: brief.travel?.responses || [], pending, questionnaires: brief.travel?.questionnaires || [] });
  } catch (err) { next(err); }
});

// Cancel a pending travel token (delete by email)
app.delete('/api/briefs/:id/travel-pending', requireAdmin, async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await db.cancelTravelTokensFor(req.params.id, email);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Resend travel questionnaire to one person
app.post('/api/briefs/:id/travel-pending/resend', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass)
    return res.status(400).json({ error: 'Email not configured.' });
  const { email, name, role } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  await db.cancelTravelTokensFor(req.params.id, email);

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await db.insertTravelToken({ token, briefId: req.params.id, name, email, role: role || '', expiresAt });

  const appUrl    = resolveAppUrl(req);
  const venueName = brief.venue?.name || 'the upcoming show';
  const showDate  = brief.timeline?.showDate || '';
  const org       = settings.orgName || 'GenX Takeover Security';
  const formUrl   = `${appUrl}/travel/${token}`;
  const dateStr   = showDate ? new Date(showDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : '';

  const orgEsc     = escapeHtml(org);
  const nameEsc    = escapeHtml(name || 'there');
  const venueEsc   = escapeHtml(venueName);
  const dateEsc    = escapeHtml(dateStr);
  const formUrlEsc = escapeHtml(formUrl);
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0d1117;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #30363d;overflow:hidden;">
<tr><td style="background:#58a6ff;padding:24px 32px;">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.8);">${orgEsc}</p>
  <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;color:#fff;">Travel Info Request ✈️</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#e6edf3;">Hi ${nameEsc},</p>
  <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#8b949e;">We're coordinating travel for <strong style="color:#e6edf3;">${venueEsc}</strong>${dateEsc ? ` on <strong style="color:#e6edf3;">${dateEsc}</strong>` : ''}. Please fill out your flight details so we can build the travel brief and coordinate pickups.</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
    <a href="${formUrlEsc}" style="display:inline-block;background:#58a6ff;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Enter My Travel Info →</a>
  </td></tr></table>
  <p style="margin:0 0 8px;font-size:13px;color:#8b949e;">Or copy this link:</p>
  <p style="margin:0 0 24px;font-size:12px;color:#58a6ff;word-break:break-all;">${formUrlEsc}</p>
  <p style="margin:0;font-size:12px;color:#484f58;">— ${orgEsc} Travel Coordination</p>
</td></tr>
</table></td></tr></table></body></html>`;

  try {
    await makeTransporter().sendMail({
      from: fromAddress(), to: email,
      subject: `Travel Info Needed — ${venueName}${dateStr ? ' · ' + dateStr : ''}`,
      html
    });
    res.json({ ok: true });
  } catch (err) {
    await db.deleteTravelToken(token);
    res.status(500).json({ error: 'Failed to send: ' + err.message });
  }
});

// Delete a submitted travel response
app.delete('/api/briefs/:id/travel-response', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    if (brief.travel?.responses) {
      brief.travel.responses = brief.travel.responses.filter(r => r.email !== email);
    }
    await db.upsertBrief(brief);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Cancel venue intake (delete token + clear brief status)
app.delete('/api/briefs/:id/intake', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    await db.cancelIntakeTokensForBrief(req.params.id);
    brief.venueIntake = null;
    await db.upsertBrief(brief);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Resend venue intake email (same email, new token)
app.post('/api/briefs/:id/intake/resend', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass)
    return res.status(400).json({ error: 'Email not configured.' });
  const venueEmail = brief.venueIntake?.venueEmail;
  if (!venueEmail) return res.status(400).json({ error: 'No email on record.' });

  await db.cancelIntakeTokensForBrief(req.params.id);

  const token = uuidv4();
  const expiresAt = computeIntakeExpiry(brief);
  await db.insertIntakeToken({ token, briefId: req.params.id, venueEmail, expiresAt });

  brief.venueIntake = { status: 'pending', sentAt: new Date().toISOString(), venueEmail };
  await db.upsertBrief(brief);

  const appUrl    = resolveAppUrl(req);
  const intakeUrl = `${appUrl}/intake/${token}`;
  try {
    await makeTransporter().sendMail({
      from: fromAddress(),
      to: venueEmail,
      subject: (settings.emailSubject || 'Venue Security Questionnaire — [Event Name]')
        .replace(/\[Event Name\]/g, brief.venue?.name || 'Security Brief')
        .replace(/\[Venue\]/g,     brief.venue?.name || 'Security Brief')
        .replace(/\[Date\]/g,      brief.timeline?.showDate || ''),
      html: venueIntakeEmailHtml(intakeUrl, brief, expiresAt)
    });
    res.json({ ok: true });
  } catch (err) {
    await db.deleteIntakeToken(token);
    res.status(500).json({ error: 'Failed to send: ' + err.message });
  }
});

// Fillable questionnaire PDF (true AcroForm fields — venues type into it in
// any PDF viewer). Pre-fills venue basics + header from the brief.
app.get('/api/briefs/:id/intake/pdf', requireAdmin, async (req, res) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });
    const { buildIntakePdf } = require('./intake-pdf');
    const bytes = await buildIntakePdf({
      brief,
      orgName: settings.orgName || 'GenX Corporate Security',
      orgEmail: settings.orgEmail || ''
    });
    const venueSlug = (brief.venue?.name || 'venue').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'venue';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="security-questionnaire-${venueSlug}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error('Intake PDF error:', err.message);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

// Create an intake link WITHOUT sending email — for when SMTP delivery is
// unreliable (spam filtering). Steve copies the link into his own email/text.
app.post('/api/briefs/:id/intake/link', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    await db.cancelIntakeTokensForBrief(req.params.id);
    const token     = uuidv4();
    const expiresAt = computeIntakeExpiry(brief);
    const venueEmail = (req.body?.venueEmail || '').toString().trim();
    await db.insertIntakeToken({ token, briefId: req.params.id, venueEmail, expiresAt });

    brief.venueIntake = { status: 'pending', sentAt: new Date().toISOString(), venueEmail, viaLink: true };
    await db.upsertBrief(brief);

    res.json({ ok: true, intakeUrl: `${resolveAppUrl(req)}/intake/${token}`, expiresAt });
  } catch (err) { next(err); }
});

// AI document import — extract questionnaire answers from a completed PDF or
// photographed form. Returns the extracted fields for review; nothing is saved
// until /intake/apply is called.
app.post('/api/briefs/:id/intake/import', requireAdmin, async (req, res) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const { file, mediaType, filename } = req.body || {};
    if (!file || typeof file !== 'string') return res.status(400).json({ error: 'No file provided.' });
    const b64 = file.replace(/^data:[^;]+;base64,/, '');
    const isPdf = /pdf/i.test(mediaType || '') || /\.pdf$/i.test(filename || '');

    // Fast path: a digitally-filled copy of our own PDF has real form fields —
    // read the answers exactly, no AI involved.
    if (isPdf) {
      try {
        const { extractFromFilledPdf } = require('./intake-pdf');
        const exact = await extractFromFilledPdf(Buffer.from(b64, 'base64'));
        if (exact) {
          const norm = normalizeIntakeData(exact);
          return res.json({ ok: true, extracted: norm.data, issues: norm.issues, fieldCount: Object.keys(norm.data).length, source: 'form-fields' });
        }
      } catch (e) { console.error('AcroForm extract failed, falling back to AI:', e.message); }
    }

    if (!settings.anthropicKey) return res.status(400).json({ error: 'This file has no fillable form data, and no Anthropic API key is configured in Settings for AI extraction.' });
    const docBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: b64 } };

    const instructions = `This document is a completed "Venue Security Questionnaire" for a live-event security advance (it may be a filled PDF, a scan, or a photo of a paper form — handwriting included).

Extract every answer into the JSON schema. Rules:
- Use null for any field that is blank, illegible, or not present in the document. Never guess or infer an answer that isn't written.
- Yes/No/Unknown questions: return "yes" only when Yes is clearly marked, "no" only when No is clearly marked, "unknown" when an Unknown/Not-sure box is marked. Blank = null.
- Checkbox fields (screening methods, door systems): true only when the box is clearly checked or the item is clearly circled/indicated; otherwise null.
- Dates: YYYY-MM-DD. Times: HH:MM 24-hour when unambiguous, otherwise transcribe verbatim (e.g. "TBD", "after lunch").
- "N/A", "none", or a dash written by the venue IS an answer — transcribe it verbatim as the string value.
- emergencyContacts: one entry per contact row that has at least a name or phone. Empty rows are omitted.
- Transcribe free-text answers faithfully; fix obvious OCR artifacts but do not paraphrase.`;

    const client = new Anthropic({ apiKey: settings.anthropicKey });
    const baseReq = {
      model: 'claude-opus-4-8',
      max_tokens: 8192,
      messages: [{ role: 'user', content: [docBlock, { type: 'text', text: instructions }] }]
    };
    let msg;
    try {
      msg = await client.messages.create({
        ...baseReq,
        output_config: { format: { type: 'json_schema', schema: intakeExtractionSchema() } }
      });
    } catch (e) {
      // Structured-output rejected (older API surface) — fall back to prompt-enforced JSON
      if (e?.status === 400) {
        msg = await client.messages.create({
          ...baseReq,
          messages: [{ role: 'user', content: [docBlock, { type: 'text', text: instructions + '\n\nRespond with ONLY a valid JSON object matching this schema (no markdown fences):\n' + JSON.stringify(intakeExtractionSchema()) }] }]
        });
      } else throw e;
    }

    let content = (msg.content || []).find(b => b.type === 'text')?.text || '';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const raw = JSON.parse(content);

    // Drop empties so the review screen only shows real answers
    const extracted = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v) && !v.length) continue;
      extracted[k] = v;
    }
    const norm = normalizeIntakeData(extracted);
    res.json({ ok: true, extracted: norm.data, issues: norm.issues, fieldCount: Object.keys(norm.data).length });
  } catch (err) {
    console.error('Intake import error:', err.message);
    res.status(500).json({ error: 'Extraction failed: ' + err.message });
  }
});

// Apply reviewed import data — same merge path as a live venue submission.
app.post('/api/briefs/:id/intake/apply', requireAdmin, async (req, res, next) => {
  try {
    const brief = await db.getBrief(req.params.id);
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const raw = sanitiseFormBody(req.body?.data) || {};
    if (!Object.keys(raw).length) return res.status(400).json({ error: 'No data to apply.' });
    const { data, issues } = normalizeIntakeData(raw);

    brief.venueIntake = {
      status: 'completed',
      submittedAt: new Date().toISOString(),
      venueEmail: brief.venueIntake?.venueEmail || '',
      sentAt: brief.venueIntake?.sentAt,
      source: 'document-import',
      data: { ...(brief.venueIntake?.data || {}), ...data },
      issues
    };
    mergeIntakeIntoBrief(brief, data);
    mergeEmergencyContacts(brief, data.emergencyContacts);
    await db.upsertBrief(brief);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// AI-generate travel brief
app.post('/api/briefs/:id/generate-travel-brief', requireAdmin, async (req, res) => {
  const brief = await db.getBrief(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!settings.anthropicKey) return res.status(400).json({ error: 'No API key configured.' });
  const responses = brief.travel?.responses || [];
  if (responses.length === 0) return res.status(400).json({ error: 'No travel responses yet.' });

  const venueName = brief.venue?.name || 'the venue';
  const showDate  = brief.timeline?.showDate || '';
  const hotelName = brief.hotel?.name || '';

  const prompt = `You are a professional tour/event travel coordinator. Based on the following traveler submissions, generate a clean, organized travel brief.

EVENT: ${venueName}${showDate ? ' — Show Date: ' + showDate : ''}${hotelName ? '\nHOTEL: ' + hotelName : ''}

TRAVELER SUBMISSIONS:
${responses.map((r, i) => `${i+1}. ${r.name} (${r.role || 'Unknown'})
${Object.entries(r).filter(([k]) => !['name','email','role','submittedAt','token'].includes(k)).map(([k,v]) => `   ${k}: ${v}`).join('\n')}`).join('\n\n')}

Generate a travel brief with these sections:
1. ARRIVALS — grouped by date, sorted by time, include: traveler name, role, airline/flight, arrival time, origin airport, pickup needs
2. DEPARTURES — same format
3. GROUND TRANSPORTATION SUMMARY — who needs pickup, when, from where
4. SPECIAL NOTES — any dietary, accessibility, or other special requests

Format clearly with headers. Be concise and practical. Use 24-hour time where possible.`;

  try {
    const client = new Anthropic({ apiKey: settings.anthropicKey });
    const msg = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role:'user', content: prompt }] });
    const text = msg.content?.[0]?.text || '';
    if (!brief.travel) brief.travel = {};
    brief.travel.generatedBrief = { text, generatedAt: new Date().toISOString() };
    await db.upsertBrief(brief);
    res.json({ ok: true, brief: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Roster routes ─────────────────────────────────────────────────────────────
app.get('/api/roster', requireAdmin, async (req, res, next) => {
  try { res.json(await db.listRoster()); } catch (err) { next(err); }
});

app.post('/api/roster', requireAdmin, async (req, res, next) => {
  try {
    const { name, email, role, phone, category, photo } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const person = { id: uuidv4(), name, email: email || '', role: role || '', phone: phone || '', category: category || 'crew', photo: photo || '', createdAt: new Date().toISOString() };
    await db.insertRosterPerson(person);
    res.json(person);
  } catch (err) { next(err); }
});

app.put('/api/roster/:id', requireAdmin, async (req, res, next) => {
  try {
    const list = await db.listRoster();
    const existing = list.find(p => p.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt };
    await db.updateRosterPerson(req.params.id, updated);
    res.json(updated);
  } catch (err) { next(err); }
});

app.delete('/api/roster/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await db.deleteRosterPerson(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Import people from all existing briefs into roster
app.post('/api/roster/import-from-briefs', requireAdmin, async (req, res, next) => {
  try {
    const allBriefs = await db.listBriefs();
    const roster = await db.listRoster();
    const candidates = [];
    for (const brief of allBriefs) {
      for (const p of (brief.talent || [])) {
        if (p.name) candidates.push({ name: p.name, stageName: p.stageName || '', role: p.role || '', phone: '', email: '', photo: p.photo || '', category: 'talent' });
      }
      for (const p of (brief.crew || [])) {
        if (p.name) candidates.push({ name: p.name, role: p.function || p.role || '', phone: p.phone || '', email: '', photo: p.photo || '', category: 'crew' });
      }
      for (const p of (brief.genxstaff || [])) {
        if (p.name) candidates.push({ name: p.name, role: p.role || '', phone: p.phone || '', email: p.email || '', photo: p.photo || '', category: 'staff' });
      }
    }
    let added = 0;
    for (const c of candidates) {
      const existing = roster.find(r => r.name.toLowerCase() === c.name.toLowerCase() && r.category === c.category);
      if (!existing) {
        const person = { id: uuidv4(), ...c, createdAt: new Date().toISOString() };
        await db.insertRosterPerson(person);
        roster.push(person);
        added++;
      } else if (c.stageName && !existing.stageName) {
        existing.stageName = c.stageName;
        await db.updateRosterPerson(existing.id, existing);
        added++;
      }
    }
    res.json({ added, total: roster.length });
  } catch (err) { next(err); }
});

// ── Page routes ──────────────────────────────────────────────────────────────
const pub = path.join(__dirname, 'public');

// Asset build stamp, derived from the front-end files themselves. Pages get
// their ?v= rewritten to this at serve time, so a deploy can never ship HTML
// pointing at a stale app.js/style.css because someone forgot to bump a
// hard-coded number. /api/build lets an already-open tab notice it is stale.
// Hash the file CONTENTS, not their mtimes — Vercel gives every deployed file
// the same fixed mtime, so an mtime-derived stamp never changes and the
// staleness check silently does nothing.
const BUILD = (() => {
  try {
    const h = require('crypto').createHash('md5');
    for (const f of ['app.js', 'style.css']) h.update(fs.readFileSync(path.join(pub, f)));
    return h.digest('hex').slice(0, 10);
  } catch (_) { return Date.now().toString(36); }
})();

function sendHtml(res, file) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  let html;
  try { html = fs.readFileSync(path.join(pub, file), 'utf8'); }
  catch (_) { return res.sendFile(path.join(pub, file)); }
  html = html
    .replace(/\?v=\d+/g, '?v=' + BUILD)
    .replace('<head>', '<head>\n  <meta name="build" content="' + BUILD + '">');
  res.type('html').send(html);
}
app.get('/api/build', (_, res) => res.json({ build: BUILD }));
app.get('/',           (_, res) => sendHtml(res, 'index.html'));
app.get('/brief',      (_, res) => sendHtml(res, 'brief.html'));
app.get('/view',       (_, res) => sendHtml(res, 'view.html'));
app.get('/settings',   (_, res) => sendHtml(res, 'settings.html'));
app.get('/risk',       (_, res) => sendHtml(res, 'risk.html'));
app.get('/intake/:token', (_, res) => sendHtml(res, 'intake.html'));
app.get('/travel/:token', (_, res) => sendHtml(res, 'travel-form.html'));
app.get('/map-editor',   (_, res) => sendHtml(res, 'map-editor.html'));
app.get('/roster', (_, res) => sendHtml(res, 'roster.html'));
app.get('/login',  (_, res) => sendHtml(res, 'login.html'));
app.get('/portal', (_, res) => sendHtml(res, 'portal.html'));
app.get('*',           (_, res) => sendHtml(res, 'index.html'));

// Final error handler — catches multer fileFilter rejections, body-parser errors, etc.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.name === 'MulterError' || /Only (images|image)/.test(err.message) ? 400 : 500);
  res.status(status).json({ error: err.message || 'Server error' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`GenX Security running on http://localhost:${PORT}`));
}

module.exports = app;
