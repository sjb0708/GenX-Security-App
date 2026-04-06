'use strict';

const express    = require('express');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const fs         = require('fs');
const Anthropic  = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

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
const DATA_DIR      = process.env.VERCEL ? '/tmp' : __dirname;
const SETTINGS_FILE = path.join(DATA_DIR, '.settings.json');
const BRIEFS_FILE   = path.join(DATA_DIR, '.briefs.json');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (_) {}
}

// ── Photo library store ───────────────────────────────────────────────────────
const PHOTOS_FILE = path.join(DATA_DIR, '.photos.json');
let photoLibrary = loadJSON(PHOTOS_FILE, []);

// ── Settings store ────────────────────────────────────────────────────────────
const settings = Object.assign({
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  orgName: 'GenX Takeover Security',
  orgContact: '', orgEmail: '', orgPhone: '',
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '',
  smtpFrom: '', smtpFromName: 'GenX Takeover Security',
  notifyEmail: '', appUrl: process.env.APP_URL || '',
  emailSubject: '', emailIntro: '', emailInstructions: ''
}, loadJSON(SETTINGS_FILE, {}));

// ── Venue intake token store ───────────────────────────────────────────────────
const TOKENS_FILE = path.join(DATA_DIR, '.tokens.json');
let intakeTokens = loadJSON(TOKENS_FILE, {});
function saveTokens() { saveJSON(TOKENS_FILE, intakeTokens); }

// ── In-memory store ──────────────────────────────────────────────────────────
const briefs = new Map();

// ── Demo data (loaded from demo-data.json) ────────────────────────────────────
const demoBriefs = loadJSON(path.join(__dirname, 'demo-data.json'), {});
Object.entries(demoBriefs).forEach(([id, b]) => briefs.set(id, b));

// Legacy inline demo placeholder (kept for reference, overridden by demo-data.json)
if (false) { const demoId = 'demo-001'; briefs.set(demoId, {
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
}); } // end if(false)

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
  } catch (_) {}

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

app.put('/api/settings', (req, res) => {
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
  saveJSON(SETTINGS_FILE, settings);
  res.json({ ok: true, hasKey: !!settings.anthropicKey, hasSmtp: !!(settings.smtpHost && settings.smtpUser && settings.smtpPass) });
});

// ── Risk Assessment ───────────────────────────────────────────────────────────
app.get('/api/risk/:id', (req, res) => {
  const brief = briefs.get(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  if (!brief.riskAssessment) return res.status(404).json({ error: 'No saved assessment' });
  res.json(brief.riskAssessment);
});

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
      census: crimeData.census,
      venueState: brief.venue?.state || ''
    };

    // Save assessment to brief so it can be loaded without regenerating
    brief.riskAssessment = assessment;
    briefs.set(req.params.id, brief);
    saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));

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
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Migrate any existing base64 photos to files on startup (skip on Vercel — no persistent /public/uploads)
(function migrateBase64Photos() {
  if (process.env.VERCEL) return;
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

  // Use custom template text if set, otherwise fall back to defaults
  const introText = (settings.emailIntro || `You are receiving this email from the ${org} security team. We have been contracted to provide security services for the upcoming event at [Venue]${date ? ' on [Date]' : ''}.

As part of our pre-event planning process, we ask that your venue security team complete the attached questionnaire. The information you provide allows us to coordinate effectively with your staff, align on protocols, and build a comprehensive security brief prior to the event.`)
    .replace(/\[Org\]/g, org)
    .replace(/\[Venue\]/g, `<strong style="color:#e6edf3;">${event}</strong>`)
    .replace(/\[Date\]/g, date ? `<strong style="color:#e6edf3;">${date}</strong>` : '');

  const instructionsText = (settings.emailInstructions || 'Please fill out as much as you can — not every field will apply to your venue, and nothing is required. Once complete, click Submit and our team will be notified immediately.')
    .replace(/\[Org\]/g, org)
    .replace(/\[Venue\]/g, event)
    .replace(/\[Date\]/g, date);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0d1117;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px;">
<table width="560" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:12px;border:1px solid #30363d;overflow:hidden;">
<tr><td style="background:#e63946;padding:24px 32px;">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.7);">${org}</p>
  <h1 style="margin:8px 0 0;font-size:22px;font-weight:800;color:#fff;">Venue Security Questionnaire</h1>
</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#e6edf3;">Hello,</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#8b949e;white-space:pre-wrap;">${introText}</p>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#8b949e;">${instructionsText}</p>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 28px;">
    <a href="${intakeUrl}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Complete Questionnaire →</a>
  </td></tr></table>
  <p style="margin:0 0 8px;font-size:13px;color:#8b949e;">Or copy this link into your browser:</p>
  <p style="margin:0 0 24px;font-size:12px;color:#58a6ff;word-break:break-all;">${intakeUrl}</p>
  <table width="100%" cellpadding="12" cellspacing="0" style="background:#0d1117;border-radius:8px;border:1px solid #30363d;margin-bottom:24px;">
    <tr><td style="font-size:12px;color:#8b949e;line-height:1.8;">
      <strong style="color:#e6edf3;">Important:</strong> This link is valid until <strong style="color:#e6edf3;">${exp}</strong> and can only be used once. Once you submit, access to the questionnaire will close automatically.<br><br>
      If you have any questions or need to reach our team directly, please reply to this email.
    </td></tr>
  </table>
  <p style="margin:0 0 4px;font-size:13px;color:#e6edf3;font-weight:600;">Thank you for your cooperation.</p>
  <p style="margin:0;font-size:12px;color:#484f58;">— ${org} Security Operations</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

function intakeNotificationEmailHtml(brief, token, briefUrl, data) {
  const venue = brief?.venue?.name || token.venueName || 'Unknown Venue';
  const date  = brief?.timeline?.showDate || '';
  const rows  = Object.entries(data).map(([k, v]) => {
    const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    return `<tr><td style="padding:6px 8px;font-size:12px;color:#8b949e;white-space:nowrap;border-bottom:1px solid #21262d;">${label}</td><td style="padding:6px 8px;font-size:12px;color:#e6edf3;border-bottom:1px solid #21262d;">${String(v||'').slice(0,200)}</td></tr>`;
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
    <a href="${briefUrl}" style="display:inline-block;background:#e63946;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:700;font-size:14px;">Open Brief & Apply Updates</a>
  </td></tr></table>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Test email route ──────────────────────────────────────────────────────────
app.post('/api/settings/test-email', async (req, res) => {
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
        <p style="color:#484f58;font-size:12px;">— ${settings.orgName || 'GenX Takeover Security'}</p>
      </div>`
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Venue Intake routes ───────────────────────────────────────────────────────

// Send intake link to venue contact
app.post('/api/briefs/:id/send-venue-intake', async (req, res) => {
  const brief = briefs.get(req.params.id);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });

  const { venueEmail } = req.body;
  if (!venueEmail) return res.status(400).json({ error: 'venueEmail is required' });
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    return res.status(400).json({ error: 'Email not configured. Add SMTP settings in Settings.' });
  }

  // Cancel any active tokens for this brief
  Object.values(intakeTokens).forEach(t => {
    if (t.briefId === req.params.id && !t.used) t.cancelled = true;
  });

  const token     = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  intakeTokens[token] = { briefId: req.params.id, venueEmail, createdAt: new Date().toISOString(), expiresAt, used: false, cancelled: false };
  saveTokens();

  brief.venueIntake = { status: 'pending', sentAt: new Date().toISOString(), venueEmail };
  briefs.set(req.params.id, brief);
  saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));

  const appUrl    = (settings.appUrl || `http://localhost:${PORT}`).replace(/\/$/, '');
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
    // Revert on email failure
    delete intakeTokens[token];
    saveTokens();
    brief.venueIntake = null;
    briefs.set(req.params.id, brief);
    saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

// Venue fetches intake form data
app.get('/api/intake/:token', (req, res) => {
  const t = intakeTokens[req.params.token];
  if (!t || t.cancelled)                    return res.status(410).json({ error: 'This link is no longer valid.' });
  if (t.used)                               return res.status(410).json({ error: 'This questionnaire has already been submitted. Thank you!' });
  if (new Date(t.expiresAt) < new Date())   return res.status(410).json({ error: 'This link has expired. Please contact the security company.' });
  const brief = briefs.get(t.briefId);
  res.json({
    venueName:  brief?.venue?.name   || '',
    venueStreet:brief?.venue?.street || '',
    venueCity:  brief?.venue?.city   || '',
    venueState: brief?.venue?.state  || '',
    venueZip:   brief?.venue?.zip    || '',
    eventDate:  brief?.timeline?.showDate || '',
    orgName:    settings.orgName || 'GenX Takeover Security',
    expiresAt:  t.expiresAt
  });
});

// Venue submits intake form
app.post('/api/intake/:token', async (req, res) => {
  const t = intakeTokens[req.params.token];
  if (!t || t.cancelled)                    return res.status(410).json({ error: 'This link is no longer valid.' });
  if (t.used)                               return res.status(410).json({ error: 'Already submitted.' });
  if (new Date(t.expiresAt) < new Date())   return res.status(410).json({ error: 'Link expired.' });

  t.used = true;
  t.submittedAt = new Date().toISOString();
  saveTokens();

  const brief = briefs.get(t.briefId);
  if (brief) {
    brief.venueIntake = {
      status: 'completed',
      submittedAt: t.submittedAt,
      venueEmail: t.venueEmail,
      sentAt: brief.venueIntake?.sentAt,
      data: req.body
    };
    briefs.set(t.briefId, brief);
    saveJSON(BRIEFS_FILE, Object.fromEntries(briefs));
  }

  // Notify Steve
  const notifyTo = settings.notifyEmail || settings.orgEmail;
  if (notifyTo && settings.smtpHost && settings.smtpUser && settings.smtpPass) {
    const appUrl   = (settings.appUrl || `http://localhost:${PORT}`).replace(/\/$/, '');
    const briefUrl = `${appUrl}/brief?id=${t.briefId}`;
    try {
      await makeTransporter().sendMail({
        from: fromAddress(),
        to: notifyTo,
        subject: `Venue Intake Completed — ${brief?.venue?.name || t.venueEmail}`,
        html: intakeNotificationEmailHtml(brief, t, briefUrl, req.body)
      });
    } catch (err) { console.error('Intake notification email failed:', err.message); }
  }

  res.json({ ok: true });
});

// ── Page routes ──────────────────────────────────────────────────────────────
const pub = path.join(__dirname, 'public');
app.get('/',           (_, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/brief',      (_, res) => res.sendFile(path.join(pub, 'brief.html')));
app.get('/view',       (_, res) => res.sendFile(path.join(pub, 'view.html')));
app.get('/settings',   (_, res) => res.sendFile(path.join(pub, 'settings.html')));
app.get('/risk',       (_, res) => res.sendFile(path.join(pub, 'risk.html')));
app.get('/intake/:token', (_, res) => res.sendFile(path.join(pub, 'intake.html')));
app.get('/map-editor',   (_, res) => res.sendFile(path.join(pub, 'map-editor.html')));
app.get('*',           (_, res) => res.sendFile(path.join(pub, 'index.html')));

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`GenX Security running on http://localhost:${PORT}`));
}

module.exports = app;
