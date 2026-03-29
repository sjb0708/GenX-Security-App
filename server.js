'use strict';

const express   = require('express');
const multer    = require('multer');
const { v4: uuidv4 } = require('uuid');
const path      = require('path');
const fs        = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ── Persistence helpers ───────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(__dirname, '.settings.json');
const BRIEFS_FILE   = path.join(__dirname, '.briefs.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (_) {}
}

// ── Photo library store ───────────────────────────────────────────────────────
const PHOTOS_FILE = path.join(__dirname, '.photos.json');
let photoLibrary = loadJSON(PHOTOS_FILE, []);

// ── Settings store ────────────────────────────────────────────────────────────
const settings = Object.assign({
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  orgName: 'GenX Takeover Security',
  orgContact: '', orgEmail: '', orgPhone: ''
}, loadJSON(SETTINGS_FILE, {}));

// ── In-memory store ──────────────────────────────────────────────────────────
const briefs = new Map();

// ── Demo data ────────────────────────────────────────────────────────────────
const demoId = 'demo-001';
briefs.set(demoId, {
  id: demoId,
  createdAt: new Date('2025-06-10T14:00:00Z').toISOString(),
  updatedAt: new Date('2025-06-10T18:30:00Z').toISOString(),

  venue: {
    name:     'Mesa Arts Center',
    street:   '1 E Main St',
    city:     'Mesa',
    state:    'AZ',
    zip:      '85201',
    phone:    '(480) 644-6500',
    capacity: '1900',
    type:     'Performing Arts Center'
  },

  hotel: {
    name:        'Sheraton Mesa Hotel at Wrigleyville West',
    street:      '860 N Dobson Rd',
    city:        'Mesa',
    state:       'AZ',
    zip:         '85201',
    phone:       '(480) 664-1221',
    checkin:     '2025-07-14',
    checkinTime: '15:00',
    checkout:    '2025-07-16',
    checkoutTime:'11:00',
    roomBlock:   'GenX Takeover',
    floor:       '4'
  },

  timeline: {
    arrivalDate:   '2025-07-14',
    arrivalTime:   '14:00',
    mediaDate:     '2025-07-15',
    mediaTime:     '10:00',
    showDate:      '2025-07-15',
    doorsTime:     '18:30',
    showTime:      '20:00',
    departureDate: '2025-07-16',
    departureTime: '09:00',
    notes: 'All talent to be escorted from hotel to venue. No early access without security presence. Media credential check at Stage Door only.'
  },

  contacts: {
    primary: {
      name:  'Marcus Webb',
      title: 'Director of Security',
      email: 'mwebb@genxsecurity.com',
      phone: '(602) 555-0142',
      cell:  '(602) 555-8871'
    },
    backup: {
      name:  'Dana Ortiz',
      title: 'Security Supervisor',
      email: 'dortiz@genxsecurity.com',
      phone: '(602) 555-0143',
      cell:  '(602) 555-9934'
    }
  },

  ingress: {
    magnetometer:    true,
    bagCheck:        true,
    wand:            true,
    patDown:         false,
    visualInspection:true,
    ticketingType:   'Digital + Physical',
    gateCount:       '4',
    gateOpenTime:    '18:00',
    notes: 'Magnetometers at main entrance (Gates 1 & 2). Bag check at all gates. No bags larger than 12"x6"x12". Clear bag policy in effect.',
    prohibitedItems: ['Weapons','Outside Food/Beverages','Professional Cameras','Laser Pointers','Selfie Sticks','Backpacks over 12"']
  },

  staffing: {
    totalSecurity:    24,
    ushers:           12,
    leo:              4,
    backstageSecurity:6,
    vipSecurity:      3,
    supervisors:      3,
    uniformed:        true,
    uniformDesc:      'Black polo shirt with GenX Security patch, black tactical pants, black boots. Supervisors wear red lanyard.',
    notes: '4 off-duty MCPD officers assigned to perimeter and main entrance. All staff briefed at 17:00 in loading dock.'
  },

  medical: {
    onSite:           true,
    emtCount:         2,
    aedCount:         4,
    aedLocations:     'Main lobby (east wall), backstage corridor, VIP lounge, loading dock',
    firstAidLocations:'Medical station near Gate 2, backstage right',
    emergencyProtocol:'In case of medical emergency: 1) Call 911 immediately. 2) Notify Command Post. 3) Clear area around patient. 4) Do not move patient unless in immediate danger. 5) Meet EMS at Gate 1.',
    hospitalName:     'Banner Desert Medical Center',
    hospitalAddress:  '1400 S Dobson Rd, Mesa, AZ 85202',
    hospitalPhone:    '(480) 412-3000',
    announcementMethod:'PA System + Radio'
  },

  evacuation: {
    primaryExit:   'Main lobby doors (north facade) to E Main St',
    secondaryExit: 'Stage door (west side) to loading dock / N Center St',
    safeRooms:     ['Green Room','Main Office','Loading Dock'],
    rallyPoint:    'Mesa Convention Center Parking Lot (north side)',
    eapNotes:      'Evacuation signal: 3 short blasts on venue PA followed by "Please proceed to the nearest exit." Security sweeps begin from rear of venue forward. Do not use elevators.',
    lockdownProtocol:'Lockdown signal: continuous tone on PA. Lock all perimeter doors. Move patrons to interior rooms. No entry or exit until all-clear from MCPD Command.'
  },

  meetgreet: {
    scheduled:    true,
    time:         '17:30',
    duration:     '45',
    location:     'VIP Lounge — Level 2, East Wing',
    capacity:     '30',
    protocol:     "Fans escorted in groups of 10 by VIP Security. No gifts over 8\" in any dimension. One photo per fan (no selfies). Talent has final say on all interactions. Security remains within arm's reach at all times.",
    giftPolicy:   'Handmade items accepted. No food. No liquids. All gifts inspected and tagged. Gifts transported to tour bus post-show.',
    staffAssigned:3
  },

  communications: {
    radios:       true,
    radioCount:   18,
    channels: [
      { ch:'1', use:'Command / All Security' },
      { ch:'2', use:'Ingress / Gate Teams' },
      { ch:'3', use:'Backstage / Production' },
      { ch:'4', use:'VIP / Meet & Greet' },
      { ch:'5', use:'Medical / Emergency' },
      { ch:'9', use:'LEO Liaison' }
    ],
    commandPost:  'Production Office, Backstage Level — Room 104',
    commandPhone: '(602) 555-0150',
    cellOk:       true,
    notes: 'All supervisors carry both radio and cell. Radio check at 17:00 mandatory. Spare batteries in Command Post.'
  },

  access: {
    doorSystem:  'Wiegand Electronic Keycard + PIN (Allegion Schlage)',
    credentials: [
      { name:'Artist / Talent',    color:'Red',   level:'All Access' },
      { name:'Production / Crew',  color:'Blue',  level:'Production Zones' },
      { name:'Security Staff',     color:'Black', level:'All Access + Armory' },
      { name:'Press / Media',      color:'Green', level:'Designated Press Areas Only' },
      { name:'Venue Staff',        color:'White', level:'Front of House' },
      { name:'VIP Guests',         color:'Gold',  level:'VIP Lounge + Floor' }
    ],
    parkingNotes:'Artist / Crew: Loading dock (west side). Security: Lot C. General: Lot A & B (paid). ADA: Designated spaces on north facade. No vehicles in fire lane at any time.'
  },

  loadinout: {
    dockLocation:  'West side, N Center St entrance — Gate W1',
    loadinDate:    '2025-07-15',
    loadinTime:    '08:00',
    loadinNotes:   'Production company arrives 08:00. Security check-in required for all vendors. Valid ID + guest list confirmation. No tailgating through security door.',
    loadoutDate:   '2025-07-15',
    loadoutTime:   '23:30',
    loadoutNotes:  'Load-out begins immediately post-show. All talent/crew off-site by 01:00. Tour bus positioned at dock by 22:30.',
    vehicleCount:  7,
    securityAtDock:true
  },

  runofshow: [
    { time:'08:00', activity:'Venue opens — Production load-in begins',          notes:'2 security at dock. Check all credentials.',                        critical:false },
    { time:'12:00', activity:'Catering delivery — Backstage only',               notes:'Inspect all containers. Log vendor name.',                          critical:false },
    { time:'14:00', activity:'Talent arrival — Hotel transfer',                  notes:'Escort team departs hotel at 13:30. Clear Stage Door prior.',        critical:true  },
    { time:'14:30', activity:'Soundcheck begins',                                notes:'Venue closed to public. Perimeter patrol active.',                   critical:false },
    { time:'15:30', activity:'Production photo shoot (backstage)',               notes:'Approved media only. Badge check at stage door.',                    critical:false },
    { time:'17:00', activity:'Security briefing — all staff muster',             notes:'Loading dock. Attendance mandatory.',                                critical:true  },
    { time:'17:30', activity:'Meet & Greet — VIP Lounge Level 2',               notes:'VIP escort begins. 3 security in room at all times.',                critical:true  },
    { time:'18:00', activity:'Gate Open — public ingress begins',                notes:'All gates active. Mag sweep and bag check in effect.',               critical:false },
    { time:'18:30', activity:'Doors open — general admission to floor',          notes:'Monitor crowd density at floor perimeter.',                          critical:false },
    { time:'19:00', activity:'Opening act — stage security positions',           notes:'Stage left/right barrier monitors deployed.',                        critical:false },
    { time:'20:00', activity:'MAIN SHOW — GenX Takeover',                       notes:'Full security protocol active. All positions confirmed.',             critical:true  },
    { time:'21:45', activity:'Encore break — crowd management',                  notes:'Monitor exits and crowd flow. Watch barrier zones.',                 critical:false },
    { time:'22:00', activity:'Show ends — controlled egress begins',             notes:'Hold VIP until general public clear. Announce exits on PA.',         critical:true  },
    { time:'22:30', activity:'Talent departure — tour bus',                      notes:'Clear loading dock. Escort to vehicles. Block paparazzi.',           critical:true  },
    { time:'23:30', activity:'Load-out begins. Venue sweep complete.',           notes:'Final sweep team. Log all incidents. Supervisor sign-off.',          critical:false }
  ],

  talent: [
    { name:'Sherri Dindal',  stageName:'Sherri D',      role:'Lead Vocalist',         notes:'No public interaction without security present. Nut allergy — no tree nuts backstage.', photo:'' },
    { name:'Nick Harrison',  stageName:'Nix',           role:'Lead Guitarist',        notes:'Approved for brief fan interactions at stage barrier. No weapons of any kind in green room.', photo:'' },
    { name:'Kelly Manno',    stageName:'K-Mano',        role:'Drummer / Percussionist',notes:'Arrives separately. Contact tour manager for arrival ETA. Do not publish room number.', photo:'' },
    { name:'Jon Wellington', stageName:'Wellington',    role:'Bassist / Keys',        notes:'VIP access only. No photographs without explicit consent.', photo:'' },
    { name:'Justin Rupple',  stageName:'J. Rupple',     role:'MC / Hype / Vocals',    notes:'May engage crowd near barrier — keep 2 security alongside at all times.', photo:'' }
  ],

  crew: [
    { name:'Ray Dominguez', function:'Tour Manager',        phone:'(602) 555-0191', notes:'Primary point of contact for all logistics. All-access.', photo:'' },
    { name:'Tara Simmons',  function:'Production Manager',  phone:'(602) 555-0192', notes:'Stage and production zone access. Coordinates load-in/out.', photo:'' },
    { name:'Dev Patel',     function:'Security',            phone:'(602) 555-0193', notes:'Personal security for Sherri Dindal. Armed and licensed (AZ).', photo:'' },
    { name:'Cass Monroe',   function:'Publicist',           phone:'(602) 555-0194', notes:'Manages all press. Issues media credentials. No media without her approval.', photo:'' },
    { name:'Hiro Tanaka',   function:'Sound Engineer',      phone:'(602) 555-0195', notes:'FOH position. Requires unobstructed access to mixing board.', photo:'' },
    { name:'Lena Kovacs',   function:'Wardrobe / Stylist',  phone:'(602) 555-0196', notes:"Backstage access only. Will require dresser's area near green room.", photo:'' }
  ],

  emergency: [
    { role:'MCPD Non-Emergency',   name:'Mesa PD Dispatch',           phone:'(480) 644-2211', email:'' },
    { role:'Venue Security Chief', name:'Tom Briggs',                  phone:'(480) 555-0101', email:'tbriggs@mesaartscenter.com' },
    { role:'Show Promoter',        name:'Alex Rivera',                 phone:'(602) 555-0177', email:'arivera@genxpresents.com' },
    { role:'Talent Rep / Agency',  name:'Marcia Stone',                phone:'(310) 555-0188', email:'mstone@stonetalent.com' },
    { role:'Building Manager',     name:'Facilities Desk',             phone:'(480) 644-6520', email:'facilities@mesaartscenter.com' },
    { role:'Insurance / Risk',     name:'Greg Holloway',               phone:'(602) 555-0166', email:'gholloway@genxrisk.com' }
  ],

  maps: [
    { title:'Venue Floor Plan',    description:'Ground level — FOH, seating, gates',              image:'' },
    { title:'Backstage Layout',    description:'Dressing rooms, green room, stage access, dock',  image:'' },
    { title:'Parking & Perimeter', description:'Lots A/B/C, fire lanes, staging areas',           image:'' }
  ]
});

// Load any saved briefs (overrides / adds to demo data)
const savedBriefs = loadJSON(BRIEFS_FILE, {});
Object.entries(savedBriefs).forEach(([id, b]) => briefs.set(id, b));

// ── National crime baseline (FBI UCR 2022) ────────────────────────────────────
const NATIONAL_2022 = {
  population: 333287557,
  violentRate: 369.7, propertyRate: 1948.8,
  homicideRate: 6.3,  robberyRate: 55.0,
  assaultRate: 264.9, burglaryRate: 268.5,
  larcenyRate: 1384.8, mvrRate: 300.5
};

// ── Timed fetch helper (AbortController + clearTimeout so no dangling timers) ──
function timedFetch(url, ms = 5000) {
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
  } catch (_) {}

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
  } catch (_) {}

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
  } catch (_) {}

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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/briefs', (req, res) => {
  const list = [...briefs.values()].map(b => ({
    id:        b.id,
    venueName: b.venue?.name || 'Untitled Brief',
    city:      b.venue?.city || '',
    state:     b.venue?.state || '',
    showDate:  b.timeline?.showDate || '',
    talent:    (b.talent || []).length,
    crew:      (b.crew || []).length,
    updatedAt: b.updatedAt,
    createdAt: b.createdAt
  }));
  res.json(list);
});

app.post('/api/briefs', (req, res) => {
  const id  = uuidv4();
  const now = new Date().toISOString();
  briefs.set(id, { id, createdAt: now, updatedAt: now, ...req.body });
  saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));
  res.status(201).json({ id });
});

app.get('/api/briefs/:id', (req, res) => {
  const b = briefs.get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

app.put('/api/briefs/:id', (req, res) => {
  const existing = briefs.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const updated = { ...existing, ...req.body, id: req.params.id, updatedAt: new Date().toISOString() };
  briefs.set(req.params.id, updated);
  saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));
  res.json({ ok: true, updatedAt: updated.updatedAt });
});

app.delete('/api/briefs/:id', (req, res) => {
  if (!briefs.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
  briefs.delete(req.params.id);
  saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));
  res.json({ ok: true });
});

// ── Settings routes ───────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  // Never expose the full key — mask it
  const masked = settings.anthropicKey
    ? 'sk-ant-....' + settings.anthropicKey.slice(-6)
    : '';
  res.json({ ...settings, anthropicKey: masked, hasKey: !!settings.anthropicKey });
});

app.put('/api/settings', (req, res) => {
  const { anthropicKey, orgName, orgContact, orgEmail, orgPhone } = req.body;
  if (anthropicKey !== undefined && !anthropicKey.startsWith('sk-ant-....')) {
    settings.anthropicKey = anthropicKey; // only update if it's a real new key
  }
  if (orgName !== undefined) settings.orgName = orgName;
  if (orgContact !== undefined) settings.orgContact = orgContact;
  if (orgEmail !== undefined) settings.orgEmail = orgEmail;
  if (orgPhone !== undefined) settings.orgPhone = orgPhone;
  saveJSON(SETTINGS_FILE, settings);
  res.json({ ok: true, hasKey: !!settings.anthropicKey });
});

// ── Risk Assessment ───────────────────────────────────────────────────────────
app.post('/api/risk/:id', async (req, res) => {
  const brief = briefs.get(req.params.id);
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

    const prompt = `You are a professional event security consultant. Analyze this security brief and produce a detailed risk assessment. Return ONLY valid JSON with no markdown or extra text.

BRIEF DATA:
${JSON.stringify(briefSummary, null, 2)}
${briefSummary.venue?.totalTicketed ? `TOTAL TICKETED ATTENDANCE: ${briefSummary.venue.totalTicketed} (use this for all staffing ratio calculations, crowd density, and ingress throughput analysis)` : ''}
${crimePromptSection}

Return this exact JSON structure:
{
  "overallScore": <number 0-100>,
  "riskLevel": "<Low|Medium|High|Critical>",
  "categoryScores": {
    "staffing": <0-100>,
    "medical": <0-100>,
    "evacuation": <0-100>,
    "accessControl": <0-100>,
    "communications": <0-100>,
    "ingress": <0-100>
  },
  "criticalFindings": [
    { "title": "", "detail": "", "recommendation": "" }
  ],
  "mediumFindings": [
    { "title": "", "detail": "", "recommendation": "" }
  ],
  "lowFindings": [
    { "title": "", "detail": "" }
  ],
  "passingChecks": ["<string>"],
  "priorityActions": [
    { "action": "", "severity": "<Critical|Medium|Low>" }
  ],
  "crimeSummary": "<3-4 sentence analysis of the venue area crime context based on the data provided, including comparison to national averages>"
}`;

    const client = new Anthropic({ apiKey: settings.anthropicKey });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });
    let content = msg.content?.[0]?.text || '';
    // Strip markdown code fences if present
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
      census: crimeData.census
    };

    res.json(assessment);
  } catch (err) {
    console.error('Risk assessment error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate assessment' });
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const b64  = req.file.buffer.toString('base64');
  const mime = req.file.mimetype;
  res.json({ url: `data:${mime};base64,${b64}` });
});

// ── Photo Library ─────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Migrate any existing base64 photos to files on startup
(function migrateBase64Photos() {
  let changed = false;
  photoLibrary = photoLibrary.map(p => {
    if (p.url && p.url.startsWith('data:')) {
      try {
        const m = p.url.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return p;
        const ext = m[1].split('/')[1]?.replace('jpeg','jpg') || 'jpg';
        const filename = `${p.id}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(m[2], 'base64'));
        changed = true;
        return { ...p, url: `/uploads/${filename}` };
      } catch (_) { return p; }
    }
    return p;
  });
  if (changed) saveJSON(PHOTOS_FILE, photoLibrary);
})();

app.get('/api/photos', (req, res) => {
  res.json(photoLibrary.map(p => ({ id: p.id, name: p.name, url: p.url, addedAt: p.addedAt })));
});

app.post('/api/photos', upload.array('files', 100), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });
  const added = req.files.map(f => {
    const id  = uuidv4();
    const b64 = f.buffer.toString('base64');
    const url = `data:${f.mimetype};base64,${b64}`;
    return { id, name: f.originalname, url, addedAt: new Date().toISOString() };
  });
  photoLibrary = [...photoLibrary, ...added];
  saveJSON(PHOTOS_FILE, photoLibrary);
  res.json({ added: added.length, photos: added });
});

app.delete('/api/photos/:id', (req, res) => {
  if (!photoLibrary.find(p => p.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
  photoLibrary = photoLibrary.filter(p => p.id !== req.params.id);
  saveJSON(PHOTOS_FILE, photoLibrary);
  res.json({ ok: true });
});

// ── Page routes ──────────────────────────────────────────────────────────────
const pub = path.join(__dirname, 'public');
app.get('/',         (_, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/brief',    (_, res) => res.sendFile(path.join(pub, 'brief.html')));
app.get('/view',     (_, res) => res.sendFile(path.join(pub, 'view.html')));
app.get('/settings', (_, res) => res.sendFile(path.join(pub, 'settings.html')));
app.get('/risk',     (_, res) => res.sendFile(path.join(pub, 'risk.html')));
app.get('*',         (_, res) => res.sendFile(path.join(pub, 'index.html')));

app.listen(PORT, () => console.log(`GenX Security running on http://localhost:${PORT}`));
