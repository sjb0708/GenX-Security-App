'use strict';
// Fillable venue-questionnaire PDF (true AcroForm fields, so venues can type
// into it in any PDF viewer). Field names match the intake registry in
// server.js / public/intake.html — a returned copy can be read back exactly
// via its form fields, with AI extraction as the fallback for scans.
const fsMod = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const path = require('path');
// Embedded fonts (Liberation Sans, SIL OFL) — subset-embedded so the PDF renders
// identically in every viewer instead of relying on Base-14 font substitution,
// which looks heavy/fuzzy in Chrome and Windows PDF viewers.
const FONT_DIR = path.join(__dirname, 'fonts');
const loadFont = (f) => fsMod.readFileSync(path.join(FONT_DIR, f));

// Palette — matches public/intake-blank.html (professional ink/slate/navy)
const NAVY  = rgb(31/255, 58/255, 95/255);
const INK   = rgb(27/255, 36/255, 48/255);
const MUTED = rgb(90/255, 100/255, 114/255);
const FAINT = rgb(139/255, 148/255, 161/255);
const RULE  = rgb(184/255, 192/255, 202/255);
const FILL  = rgb(238/255, 242/255, 246/255);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 612, PAGE_H = 792, MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Form specification ─────────────────────────────────────────────────────
// item types: row (text fields), area (multiline), checks (checkbox group),
// radio (yes/no[/unknown] question), dropdown, note, contacts, callout, sign
const YNU = ['Yes', 'No', 'Unknown'];
const YN  = ['Yes', 'No'];

const SPEC = [
  { title: '1 · VENUE',
    why: 'Why we ask: baseline facility details anchor the written risk assessment we prepare for every engagement (ASIS General Security Risk Assessment methodology).',
    items: [
      { t: 'row', fields: [ { n: 'venueName', l: 'Venue Location', w: 2 }, { n: 'venuePhone', l: 'Main Phone', w: 1 } ] },
      { t: 'row', fields: [ { n: 'businessName', l: 'Business Name', w: 2 }, { n: 'venueCapacity', l: 'Total Capacity', w: 1 } ] },
      { t: 'row', fields: [ { n: 'venueAddress', l: 'Street Address', w: 1 } ] },
      { t: 'area', n: 'priorIncidents', l: 'Any security concerns in the last 12 months that would affect this show (write "None" if none)', h: 44 },
    ] },
  { title: '2 · CONTACTS',
    why: 'Why we ask: event-day coordination depends on reaching the right person immediately.',
    items: [
      { t: 'note', text: 'PRIMARY CONTACT', style: 'tag' },
      { t: 'row', fields: [ { n: 'secChiefName', l: 'Name', w: 1 }, { n: 'secChiefTitle', l: 'Title', w: 1 } ] },
      { t: 'row', fields: [ { n: 'secChiefPhone', l: 'Phone', w: 1 }, { n: 'secChiefEmail', l: 'Email', w: 1 } ] },
      { t: 'note', text: 'SECONDARY CONTACT', style: 'tag' },
      { t: 'note', text: 'In the event the primary is unavailable, do you have a designated secondary point of contact?', style: 'italic' },
      { t: 'row', fields: [ { n: 'facilityName', l: 'Name', w: 1 }, { n: 'facilityPhone', l: 'Phone', w: 1 } ] },
      { t: 'row', fields: [ { n: 'facilityEmail', l: 'Email', w: 1 } ] },
    ] },
  { title: '3 · INGRESS & SCREENING',
    why: 'Why we ask: screening posture drives our staffing plan and entry timeline, consistent with DHS/CISA guidance for publicly accessible venues.',
    items: [
      { t: 'checks', l: 'Screening methods available at this venue', boxes: [
        { n: 'chkMag', l: 'Magnetometer' }, { n: 'chkBag', l: 'Bag Check' }, { n: 'chkWand', l: 'Wand' },
        { n: 'chkPatDown', l: 'Pat Down' }, { n: 'chkVisual', l: 'Visual Inspection' }, { n: 'chkEvolv', l: 'Evolv' } ] },
      { t: 'row', fields: [
        { n: 'ticketingType', l: 'Ticketing Type', w: 1, dd: ['Digital', 'Physical', 'Digital + Physical', 'Complimentary', 'Mixed'] },
        { n: 'gateCount', l: 'Total Screening Entry Points', w: 1 },
        { n: 'gateOpenTime', l: 'Gate Open Time', w: 1 } ] },
      { t: 'area', n: 'prohibitedItems', l: 'Does your venue have any prohibited items? List them (one per line, or attach your policy)', h: 44 },
      { t: 'area', n: 'ingressNotes', l: 'Notes', h: 36 },
    ] },
  { title: '4 · CROWD & BARRICADE',
    why: 'Why we ask: this section applies to concert-type events. Stage-line barricade is our primary crowd-management control — what you have available determines how many personnel we position at the stage and how.',
    items: [
      { t: 'radio', n: 'barricadeNeeded', l: 'Is there a need for crowd-control barricade for this event?', sub: 'If No, skip the rest of this section.', opts: YN },
      { t: 'row', fields: [
        { n: 'crowdType', l: 'Audience Configuration', w: 1, dd: ['Fully seated', 'GA standing', 'Seated + GA pit', 'Mixed / varies by area'] },
        { n: 'barricadeType', l: 'Barricade Type Available', w: 1, dd: ['Concert barricade (mojo / blowthrough)', 'Bike rack', 'Both available', 'None', 'Other'] } ] },
      { t: 'radio', n: 'stageBarricade', l: 'Barricade at the stage for this event?', opts: YN },
      { t: 'area', n: 'barricadeNotes', l: 'Barricade / crowd notes', h: 36 },
    ] },
  { title: '5 · CCTV & SURVEILLANCE',
    why: 'Why we ask: our risk-assessment documentation and liability-insurance due diligence require us to record the venue’s surveillance capability.',
    items: [
      { t: 'radio', n: 'cctvCoverage', l: 'Venue has CCTV coverage', sub: 'Entrances, FOH, and backstage areas', opts: YN },
      { t: 'radio', n: 'cctvMonitored', l: 'Monitored live during events', opts: YN },
      { t: 'area', n: 'cctvNotes', l: 'Any additional camera concerns (optional)', h: 36 },
    ] },
  { title: '6 · STAFFING (VENUE / PRODUCTION-PROVIDED)',
    why: 'Why we ask: staffing and law-enforcement presence are core inputs to our event risk assessment (ASIS General Security Risk Assessment methodology) — together they give us a clear picture of the overall security posture and determine how many GenX personnel we assign and where they post.',
    items: [
      { t: 'row', fields: [ { n: 'totalSecurity', l: 'Estimated Security Staff (Total)', w: 1 }, { n: 'backstageSecurity', l: 'How Many Security Officers Backstage?', w: 1 } ] },
      { t: 'radio', n: 'uniformed', l: 'Uniformed staff?', sub: 'Security personnel wear identifying uniforms', opts: YN },
      { t: 'area', n: 'uniformDesc', l: 'Uniform description — e.g., black polo shirt with SECURITY logo, so our team can identify your staff', h: 36 },
      { t: 'area', n: 'staffingNotes', l: 'Staffing notes', h: 36 },
      { t: 'radio', n: 'leOnSite', l: 'Is law enforcement on-site for this event?', opts: YN },
      { t: 'row', fields: [ { n: 'leAgency', l: 'Which law-enforcement agency?', w: 1 } ] },
    ] },
  { title: '7 · MEDICAL & EMERGENCY',
    why: 'Why we ask: in the event of an issue we need to know someone trained in CPR / first aid is available, and how medical response reaches backstage.',
    items: [
      { t: 'radio', n: 'medicalOnSite', l: 'Trained medical staff on-site (CPR / first aid)', sub: 'Someone trained in CPR / first aid is on-site for this event', opts: YN },
      { t: 'row', fields: [ { n: 'firstResponderCount', l: 'Medical Staff / First Responder Count', w: 1 } ] },
      { t: 'radio', n: 'aedOnSite', l: 'AED located on site?', opts: YN },
      { t: 'radio', n: 'aedNearStage', l: 'AED close to stage & backstage?', opts: YN },
      { t: 'row', fields: [ { n: 'firstAidLocations', l: 'What is the closest first-aid location to backstage?', w: 1 } ] },
      { t: 'radio', n: 'medicalToGreenRoom', l: 'In an emergency, will the medical team respond to the green room / backstage?', opts: YN },
      { t: 'area', n: 'emergencyProtocol', l: 'In the event of an emergency, what is your protocol?', h: 52 },
      { t: 'radio', n: 'eapIncluded', l: 'Are you including an Emergency Action Plan (EAP)?', sub: 'If yes, attach it as a separate PDF when returning this form.', opts: YN },
    ] },
  { title: '8 · EVACUATION PLAN',
    why: 'Why we ask: egress routes and assembly points feed our emergency action planning, consistent with NFPA 101 (Life Safety Code) assembly-occupancy provisions.',
    items: [
      { t: 'area', n: 'primaryExit', l: 'Primary exit route from the stage', h: 36 },
      { t: 'area', n: 'secondaryExit', l: 'Secondary exit route', h: 36 },
      { t: 'area', n: 'safeRooms', l: 'Do you designate safe rooms? If so, where', h: 36 },
      { t: 'row', fields: [ { n: 'rallyPoint', l: 'Rally Points We Should Be Aware Of', w: 2 },
                            { n: 'announcementMethod', l: 'Evacuation Announcement Method', w: 1, dd: ['PA System + Radio', 'Radio Only', 'PA System Only', 'PA + Text Alert'] } ] },
      { t: 'area', n: 'lockdownProtocol', l: 'Lockdown protocol', h: 36 },
      { t: 'area', n: 'weatherPlan', l: 'Weather / show-stop plan (outdoor venues — write N/A if indoor)', h: 36 },
    ] },
  { title: '9 · MEET & GREET / GIFT POLICY',
    items: [
      { t: 'note', text: 'M&G Protocol: the tour manager and Lead Security will conduct a security walkthrough on show day. That walkthrough determines the meet-and-greet location, the setup, and how it will run.', style: 'body' },
      { t: 'note', text: 'Gift Policy: also set at the show-day walkthrough — including how gifts for the artist are received, screened, and handled. No action is needed from the venue on this form.', style: 'body' },
    ] },
  { title: '10 · COMMUNICATIONS',
    why: 'Why we ask: shared communications and a known security-operations location establish unified command between your team and ours on event day.',
    items: [
      { t: 'radio', n: 'venueShareComms', l: 'Venue and GenX Security to share radios?', opts: YN },
      { t: 'radio', n: 'opsCenterOnSite', l: 'Is there a security operations center on site?', opts: YN },
      { t: 'row', fields: [ { n: 'securityOps', l: 'Security Operations Center Location', w: 1 }, { n: 'securityOpsPhone', l: 'Security Operations Phone', w: 1 } ] },
      { t: 'radio', n: 'cellOk', l: 'GenX Security radios permitted?', opts: YN },
      { t: 'area', n: 'commsNotes', l: 'Notes', h: 36 },
    ] },
  { title: '11 · ACCESS CONTROL & TEAM ARRIVAL',
    why: 'Why we ask: this tells us how your access is set up — key card, PIN, escorted — so we know how our team, cast, and crew can move through the building, and exactly where to meet on arrival. Please also circle or arrow our entry door and meet point on the maps in Section 15.',
    items: [
      { t: 'checks', l: 'Venue access control devices', boxes: [
        { n: 'doorCardAccess', l: 'Card Access' }, { n: 'doorFacial', l: 'Facial Recognition' }, { n: 'doorPin', l: 'PIN' },
        { n: 'doorKey', l: 'Key' }, { n: 'doorFob', l: 'Fob' }, { n: 'doorOther', l: 'Other' } ] },
      { t: 'radio', n: 'backstageAccessControlled', l: 'Are the green room and backstage areas controlled by access control?', opts: YN },
      { t: 'area', n: 'castCrewAccess', l: 'Cast & crew access — where and how should cast and crew enter backstage / the venue? (entrance, door, credential check)', h: 44 },
      { t: 'area', n: 'additionalCredentials', l: 'Will our team need access cards or additional credentials? (type, color, access level)', h: 36 },
      { t: 'area', n: 'teamCheckIn', l: 'Our arrival — what door do we enter, where do we meet, what time, and what should we do on arrival?', h: 44 },
      { t: 'area', n: 'parkingNotes', l: 'Parking notes', h: 36 },
    ] },
  { title: '12 · LOAD IN / LOAD OUT',
    why: 'Why we ask: dock timing and access drive perimeter control before doors open and after the show ends.',
    items: [
      { t: 'row', fields: [ { n: 'dockLocation', l: 'Dock Location', w: 1 } ] },
      { t: 'radio', n: 'securityAtDock', l: 'Security at dock?', opts: YN },
      { t: 'area', n: 'loadinNotes', l: 'Load-in notes', h: 32 },
      { t: 'area', n: 'loadoutNotes', l: 'Load-out notes', h: 32 },
    ] },
  { title: '13 · MEDIA / PRESS DAY',
    why: 'If this event does not have a media day, mark “No” below and skip this section.',
    items: [
      { t: 'radio', n: 'mediaDay', l: 'Does this event have a media day scheduled?', sub: 'No media day? Mark No and skip to the next section.', opts: YN },
      { t: 'row', fields: [ { n: 'mediaDayDate', l: 'Media Day Date', w: 1 }, { n: 'mediaDayTime', l: 'Time Window (write TBD if not confirmed)', w: 1 }, { n: 'mediaLocation', l: 'Location', w: 1 } ] },
      { t: 'radio', n: 'mediaEscort', l: 'Media escorted while on property?', opts: YN },
      { t: 'area', n: 'mediaNotes', l: 'Media notes (outlets expected, press credentials, camera policy)', h: 36 },
    ] },
  { title: '14 · EMERGENCY CONTACTS',
    why: 'Why we ask: these contacts are loaded into our event-day command sheet for immediate notification.',
    items: [ { t: 'contacts', count: 3 } ] },
  { title: '15 · MAPS & DIAGRAMS — REQUIRED',
    why: 'Why we ask: clear maps are how our team, cast, and crew move through your facility without confusion — at previous engagements, unclear door access cost critical minutes. We only need enough for our personnel to navigate; nothing sensitive.',
    items: [
      { t: 'callout', title: 'Minimum we need — please mark these on your maps', bullets: [
        'Aerial / site view of the facility — circle or arrow the door or gate our team enters and where we meet on arrival',
        'Green room location and the backstage layout / outline',
        'Access to the stage and backstage — the routes our team needs to know are secured',
        'Driving access — how vehicles reach the loading dock, and where production parks/stages' ] },
      { t: 'callout', title: 'Anything additional is greatly appreciated', bullets: [
        'First-aid stations and AED locations',
        'Emergency / evacuation routes and rally points',
        'Security office / command post',
        'Anything else that helps cast, crew, or our security team understand where things are located' ] },
      { t: 'note', text: 'Hand-marked photocopies are welcome — legibility matters more than polish. Attach as separate pages or PDFs when returning this form.', style: 'body' },
    ] },
  { title: 'COMPLETED BY',
    why: 'The information above is accurate to the best of my knowledge as of the date signed. Please notify us of any material changes (staffing, access, construction, policies) before show day.',
    items: [
      { t: 'row', fields: [ { n: 'cbName', l: 'Completed By (Name)', w: 1 }, { n: 'cbDate', l: 'Date', w: 1 } ] },
    ] },
];

// ── Renderer ───────────────────────────────────────────────────────────────
async function buildIntakePdf({ brief = null, orgName = 'GenX Corporate Security', orgEmail = '', planning = 'Steve — 864-293-9696', onsite = 'Ben — 636-262-9094' } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let helv, bold, itali;
  try {
    helv  = await doc.embedFont(loadFont('LiberationSans-Regular.ttf'), { subset: true });
    bold  = await doc.embedFont(loadFont('LiberationSans-Bold.ttf'),    { subset: true });
    itali = await doc.embedFont(loadFont('LiberationSans-Italic.ttf'),  { subset: true });
  } catch (e) {
    // Font files unavailable (shouldn't happen) — fall back to Base-14
    helv  = await doc.embedFont(StandardFonts.Helvetica);
    bold  = await doc.embedFont(StandardFonts.HelveticaBold);
    itali = await doc.embedFont(StandardFonts.HelveticaOblique);
  }
  const form = doc.getForm();

  doc.setTitle('Venue Security Advance Questionnaire');
  doc.setAuthor(orgName);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const ensure = (h) => { if (y - h < MARGIN + 8) newPage(); };
  const text = (s, x, size, font, color, opts = {}) => page.drawText(s, { x, y: y - size, size, font, color, ...opts });

  // Wrap text to width, draw, advance y
  const para = (s, size, font, color, lineGap = 2.5, x = MARGIN, w = CONTENT_W) => {
    const words = String(s).split(/\s+/);
    let line = '';
    const lines = [];
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(probe, size) > w) { if (line) lines.push(line); line = word; }
      else line = probe;
    }
    if (line) lines.push(line);
    for (const l of lines) { ensure(size + lineGap); text(l, x, size, font, color); y -= size + lineGap; }
  };

  const label = (s, x, w) => { // small uppercase field label at current y
    page.drawText(s.toUpperCase(), { x, y: y - 7.4, size: 7.2, font: bold, color: MUTED, maxWidth: w, lineHeight: 8.6 });
  };

  const labelHeight = (s, w) => { // estimated height the wrapped label consumes
    const width = bold.widthOfTextAtSize(s.toUpperCase(), 7.2);
    return Math.ceil(width / w) * 8.6 + 2;
  };

  const textField = (name, x, w, h) => {
    const f = form.createTextField(name);
    f.addToPage(page, { x, y: y - h, width: w, height: h, borderColor: RULE, borderWidth: 0.7, backgroundColor: WHITE });
    f.setFontSize(9);
    if (h > 22) f.enableMultiline();
    return f;
  };

  // ── Section keep-together: estimate height so a section that won't fit in
  // the space left starts on a fresh page instead of splitting mid-section. ──
  const wrapCount = (s, font, size, w) => {
    const words = String(s).split(/\s+/);
    let line = '', count = 0;
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(probe, size) > w) { if (line) count++; line = word; }
      else line = probe;
    }
    return count + (line ? 1 : 0);
  };

  const measureSection = (sec) => {
    let h = 10 + 14 + 7 + 4; // header + rule + trailing gap
    if (sec.why) h += wrapCount(sec.why, itali, 7.3, CONTENT_W) * 9.8 + 3;
    for (const item of sec.items) {
      if (item.t === 'row') {
        const gap = 12;
        const unitTotal = item.fields.reduce((a, f) => a + (f.w || 1), 0);
        const unitW = (CONTENT_W - gap * (unitTotal - 1)) / unitTotal;
        h += Math.max(...item.fields.map(f => labelHeight(f.l, unitW * (f.w || 1)))) + 18 + 8;
      } else if (item.t === 'area') {
        h += labelHeight(item.l, CONTENT_W) + item.h + 8;
      } else if (item.t === 'checks') {
        h += labelHeight(item.l, CONTENT_W) + 2 + 17 + 20; // one wrap row of boxes typical
      } else if (item.t === 'radio') {
        const optW = item.opts.reduce((a, o) => a + 13 + 4 + helv.widthOfTextAtSize(o, 8.5) + 14, 0);
        const qW = CONTENT_W - optW - 8;
        let qh = wrapCount(item.l, bold, 9, qW) * 10.5;
        if (item.sub) qh += wrapCount(item.sub, helv, 7.3, qW) * 8.8;
        h += Math.max(16, qh) + 8;
      } else if (item.t === 'note') {
        if (item.style === 'tag') h += 15;
        else if (item.style === 'italic') h += wrapCount(item.text, itali, 7.5, CONTENT_W) * 10 + 2;
        else h += wrapCount(item.text, helv, 9, CONTENT_W) * 12 + 4;
      } else if (item.t === 'contacts') {
        h += item.count * 76;
      } else if (item.t === 'callout') {
        let lines = 0;
        for (const b of item.bullets) lines += wrapCount(b, helv, 8.5, CONTENT_W - 44);
        h += 28 + lines * 12 + 16;
      }
    }
    return h + 8; // safety margin
  };

  // ── Item renderers ──
  const drawSection = (sec) => {
    ensure(60);
    y -= 10;
    text(sec.title, MARGIN, 10, bold, NAVY, { characterSpacing: 1.1 });
    y -= 14;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: NAVY });
    y -= 7;
    if (sec.why) { para(sec.why, 7.3, itali, MUTED, 2); y -= 3; }
  };

  const drawRow = (fields) => {
    const gap = 12;
    const unitTotal = fields.reduce((a, f) => a + (f.w || 1), 0);
    const unitW = (CONTENT_W - gap * (unitTotal - 1)) / unitTotal;
    const lh = Math.max(...fields.map(f => labelHeight(f.l, unitW * (f.w || 1))));
    const fh = 18;
    ensure(lh + fh + 8);
    let x = MARGIN;
    const yStart = y;
    for (const f of fields) {
      const w = unitW * (f.w || 1) + (f.w > 1 ? gap * (f.w - 1) : 0);
      y = yStart;
      label(f.l, x, w);
      y -= lh;
      if (f.dd) {
        const d = form.createDropdown(f.n);
        d.addOptions(f.dd);
        d.addToPage(page, { x, y: y - fh, width: w, height: fh, borderColor: RULE, borderWidth: 0.7, backgroundColor: WHITE });
        d.setFontSize(8.5);
      } else {
        textField(f.n, x, w, fh);
      }
      x += w + gap;
    }
    y = yStart - lh - fh - 8;
  };

  const drawArea = (item) => {
    const lh = labelHeight(item.l, CONTENT_W);
    ensure(lh + item.h + 8);
    label(item.l, MARGIN, CONTENT_W);
    y -= lh;
    textField(item.n, MARGIN, CONTENT_W, item.h);
    y -= item.h + 8;
  };

  const drawChecks = (item) => {
    const lh = labelHeight(item.l, CONTENT_W);
    ensure(lh + 18);
    label(item.l, MARGIN, CONTENT_W);
    y -= lh + 2;
    let x = MARGIN;
    for (const b of item.boxes) {
      const wLabel = helv.widthOfTextAtSize(b.l, 8.5);
      const wTotal = 12 + 5 + wLabel + 16;
      if (x + wTotal > PAGE_W - MARGIN) { x = MARGIN; y -= 17; ensure(17); }
      const cb = form.createCheckBox(b.n);
      cb.addToPage(page, { x, y: y - 11, width: 11, height: 11, borderColor: MUTED, borderWidth: 0.8, backgroundColor: WHITE });
      page.drawText(b.l, { x: x + 16, y: y - 9.5, size: 8.5, font: helv, color: INK });
      x += wTotal;
    }
    y -= 20;
  };

  const drawRadio = (item) => {
    const optW = item.opts.reduce((a, o) => a + 13 + 4 + helv.widthOfTextAtSize(o, 8.5) + 14, 0);
    const qW = CONTENT_W - optW - 8;
    const rows = item.sub ? 2 : 1;
    ensure(rows * 12 + 12);
    const yStart = y;
    // question text (may wrap inside qW)
    const savedY = y;
    para(item.l, 9, bold, INK, 1.5, MARGIN, qW);
    if (item.sub) para(item.sub, 7.3, helv, MUTED, 1.5, MARGIN, qW);
    const afterQ = y;
    // options on the right, aligned to question top
    y = savedY;
    const group = form.createRadioGroup(item.n);
    let x = PAGE_W - MARGIN - optW;
    for (const o of item.opts) {
      group.addOptionToPage(o.toLowerCase(), page, { x, y: y - 12, width: 12, height: 12, borderColor: MUTED, borderWidth: 0.8, backgroundColor: WHITE });
      page.drawText(o, { x: x + 16, y: y - 10.5, size: 8.5, font: helv, color: INK });
      x += 13 + 4 + helv.widthOfTextAtSize(o, 8.5) + 14;
    }
    y = Math.min(afterQ, savedY - 16);
    y -= 7;
  };

  const drawNote = (item) => {
    if (item.style === 'tag') { ensure(16); y -= 2; text(item.text, MARGIN, 7.5, bold, NAVY, { characterSpacing: 0.8 }); y -= 13; }
    else if (item.style === 'italic') { para(item.text, 7.5, itali, MUTED); y -= 2; }
    else { para(item.text, 9, helv, INK, 3); y -= 4; }
  };

  const drawContacts = (count) => {
    for (let i = 1; i <= count; i++) {
      ensure(64);
      page.drawRectangle({ x: MARGIN, y: y - 62, width: CONTENT_W, height: 62, borderColor: RULE, borderWidth: 0.6 });
      const inner = MARGIN + 10;
      const w = (CONTENT_W - 20 - 12) / 2;
      y -= 8;
      let x = inner; const rowY = y;
      for (const [suffix, l] of [['Name', 'Name'], ['Role', 'Role / Title']]) {
        y = rowY; label(l, x, w); y -= 9; textField(`ec${suffix}_${i}`, x, w, 15); x += w + 12;
      }
      y = rowY - 9 - 15 - 6;
      x = inner; const rowY2 = y;
      for (const [suffix, l] of [['Phone', 'Phone'], ['Email', 'Email']]) {
        y = rowY2; label(l, x, w); y -= 9; textField(`ec${suffix}_${i}`, x, w, 15); x += w + 12;
      }
      y = rowY2 - 9 - 15 - 12;
    }
  };

  const drawCallout = (item) => {
    const bulletLines = [];
    for (const b of item.bullets) {
      const words = b.split(/\s+/); let line = '';
      for (const word of words) {
        const probe = line ? line + ' ' + word : word;
        if (helv.widthOfTextAtSize(probe, 8.5) > CONTENT_W - 40) { bulletLines.push({ text: line, first: line === '' }); line = word; }
        else line = probe;
      }
      bulletLines.push({ text: line, bullet: true });
    }
    // simpler: compute height = title + each bullet wrapped
    const lineH = 12;
    let hLines = 0;
    const wrapped = item.bullets.map(b => {
      const words = b.split(/\s+/); const ls = []; let line = '';
      for (const word of words) {
        const probe = line ? line + ' ' + word : word;
        if (helv.widthOfTextAtSize(probe, 8.5) > CONTENT_W - 44) { ls.push(line); line = word; }
        else line = probe;
      }
      ls.push(line); hLines += ls.length; return ls;
    });
    const boxH = 20 + hLines * lineH + 8;
    ensure(boxH + 6);
    page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: FILL, borderColor: NAVY, borderWidth: 0.9 });
    y -= 15;
    text(item.title.toUpperCase(), MARGIN + 12, 8.2, bold, NAVY, { characterSpacing: 0.5 });
    y -= 14;
    for (const ls of wrapped) {
      let first = true;
      for (const l of ls) {
        page.drawText(first ? '•  ' + l : '   ' + l, { x: MARGIN + 14, y: y - 8.5, size: 8.5, font: helv, color: INK });
        y -= lineH; first = false;
      }
    }
    y -= 10;
  };

  // ── Page 1 header ──
  const showDate = brief?.timeline?.showDate || '';
  const venueName = brief?.venue?.name || '';
  let showDateLabel = '', dueLabel = 'One week before show day';
  if (showDate) {
    try {
      const d = new Date(showDate + 'T12:00:00');
      showDateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const due = new Date(d); due.setDate(due.getDate() - 7);
      dueLabel = due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + '  (one week before show day)';
    } catch (_) { showDateLabel = showDate; }
  }

  text('CONFIDENTIAL  —  SECURITY SENSITIVE', MARGIN, 7.5, bold, NAVY, { characterSpacing: 1.6 });
  y -= 13;
  text('Venue Security Advance Questionnaire', MARGIN, 19, bold, INK);
  y -= 25;
  const orgW = bold.widthOfTextAtSize(orgName, 10);
  page.drawText(orgName, { x: PAGE_W - MARGIN - orgW, y: y + 22, size: 10, font: bold, color: INK });
  const tag = 'Event Security Advance & Coordination';
  const tagW = helv.widthOfTextAtSize(tag, 8);
  page.drawText(tag, { x: PAGE_W - MARGIN - tagW, y: y + 11, size: 8, font: helv, color: MUTED });
  para('Completed in advance of each engagement to support our documented event risk assessment and security operations plan.', 8.5, helv, MUTED, 2, MARGIN, 330);
  y -= 4;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 2.2, color: NAVY });
  y -= 10;

  // Document-control table (3 rows × 2 cols)
  const cells = [
    ['EVENT / VENUE', venueName], ['SHOW DATE', showDateLabel],
    ['PLANNING CONTACT', planning], ['ON-SITE CONTACT (EVENT DAY)', onsite],
    ['RETURN COMPLETED FORM TO (EMAIL)', orgEmail], ['RETURN NO LATER THAN', dueLabel],
  ];
  const cellW = CONTENT_W / 2, cellH = 30;
  const tableTop = y;
  for (let i = 0; i < cells.length; i++) {
    const cx = MARGIN + (i % 2) * cellW;
    const cy = tableTop - Math.floor(i / 2) * cellH;
    page.drawRectangle({ x: cx, y: cy - cellH, width: cellW, height: cellH, borderColor: RULE, borderWidth: 0.5 });
    page.drawText(cells[i][0], { x: cx + 8, y: cy - 11, size: 7, font: bold, color: FAINT, characterSpacing: 0.7 });
    if (cells[i][1]) page.drawText(String(cells[i][1]), { x: cx + 8, y: cy - 23, size: 9, font: bold, color: INK });
    else page.drawLine({ start: { x: cx + 8, y: cy - 24 }, end: { x: cx + cellW - 30, y: cy - 24 }, thickness: 0.6, color: RULE });
  }
  y = tableTop - 3 * cellH - 12;

  // Intro block — why we ask, how to return, deadline, and what the venue gets
  // back. 9pt (smaller sizes render speckly in browser PDF viewers at 100% zoom)
  // and wrapped programmatically so no line ever overflows the box.
  const INTRO_SIZE = 9, INTRO_LH = 12.6, INTRO_W = CONTENT_W - 24;
  const wrapLines = (s, font, size, w) => {
    const words = String(s).split(/\s+/);
    const lines = []; let line = '';
    for (const word of words) {
      const probe = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(probe, size) > w) { if (line) lines.push(line); line = word; }
      else line = probe;
    }
    if (line) lines.push(line);
    return lines;
  };
  const introParas = [
    { t: 'Why we ask: this information is required for our event risk assessment and liability-insurance documentation, and it ensures cast, crew, and both security teams know exactly what to do on show day.', b: false },
    { t: 'This PDF is fillable — type your answers in any PDF viewer, save, and email it back with any attachments (EAP, floor plans); clear photos of printed pages work too. Mark N/A where a section doesn’t apply. We understand some details can’t be shared for security reasons — just answer to the best of your ability.', b: false },
    { t: 'Please return no later than one week before show day.', b: true },
    { t: 'What happens next: once received, GenX Security will return a completed event security package to the venue — including the run of show, cast & crew credential photos, and day-of security contacts.', b: false },
  ];
  const introRendered = introParas.map(p => ({ b: p.b, lines: wrapLines(p.t, p.b ? bold : helv, INTRO_SIZE, INTRO_W) }));
  const introH = introRendered.reduce((a, p) => a + p.lines.length * INTRO_LH, 0) + 18;
  page.drawRectangle({ x: MARGIN, y: y - introH, width: CONTENT_W, height: introH, color: FILL });
  page.drawRectangle({ x: MARGIN, y: y - introH, width: 2.5, height: introH, color: NAVY });
  y -= 14;
  for (const p of introRendered) {
    for (const l of p.lines) {
      page.drawText(l, { x: MARGIN + 12, y: y - INTRO_SIZE, size: INTRO_SIZE, font: p.b ? bold : helv, color: rgb(0.2, 0.23, 0.28) });
      y -= INTRO_LH;
    }
  }
  y -= 12;

  // ── Sections — keep each section on one page when it can fit on one ──
  const FULL_PAGE = PAGE_H - MARGIN * 2 - 20;
  for (const sec of SPEC) {
    const est = measureSection(sec);
    const remaining = y - (MARGIN + 20);
    if (est > remaining && (est <= FULL_PAGE || remaining < 160)) newPage();
    drawSection(sec);
    for (const item of sec.items) {
      if (item.t === 'row') drawRow(item.fields);
      else if (item.t === 'area') drawArea(item);
      else if (item.t === 'checks') drawChecks(item);
      else if (item.t === 'radio') drawRadio(item);
      else if (item.t === 'note') drawNote(item);
      else if (item.t === 'contacts') drawContacts(item.count);
      else if (item.t === 'callout') drawCallout(item);
    }
    y -= 4;
  }

  // Footer on last page
  ensure(40);
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: NAVY });
  y -= 12;
  const foot1 = 'CONFIDENTIAL — SECURITY SENSITIVE INFORMATION';
  const f1w = bold.widthOfTextAtSize(foot1, 7.5);
  page.drawText(foot1, { x: (PAGE_W - f1w) / 2, y: y - 7, size: 7.5, font: bold, color: INK });
  y -= 12;
  const foot2 = `Responses are handled on a need-to-know basis and reviewed only by ${orgName} personnel assigned to this engagement.`;
  const f2w = helv.widthOfTextAtSize(foot2, 7);
  page.drawText(foot2, { x: (PAGE_W - f2w) / 2, y: y - 7, size: 7, font: helv, color: MUTED });

  // Running footer: confidential marker + page numbers on every page
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE_W - MARGIN, y: 30 }, thickness: 0.4, color: RULE });
    pg.drawText('CONFIDENTIAL — SECURITY SENSITIVE', { x: MARGIN, y: 20, size: 7, font: bold, color: FAINT, characterSpacing: 0.7 });
    const pn = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(pn, { x: PAGE_W - MARGIN - helv.widthOfTextAtSize(pn, 7), y: 20, size: 7, font: helv, color: FAINT });
    const vn = venueName ? `${venueName}${showDateLabel ? ' — ' + showDateLabel : ''}` : '';
    if (vn && i > 0) {
      const vw = helv.widthOfTextAtSize(vn, 6.5);
      pg.drawText(vn, { x: (PAGE_W - vw) / 2, y: 20, size: 6.5, font: helv, color: FAINT });
    }
  });

  // Prefill known venue basics so the venue only confirms
  try {
    if (venueName) form.getTextField('venueName').setText(venueName);
    if (brief?.venue?.phone) form.getTextField('venuePhone').setText(String(brief.venue.phone));
    if (brief?.venue?.capacity) form.getTextField('venueCapacity').setText(String(brief.venue.capacity));
  } catch (_) {}

  form.updateFieldAppearances(helv);
  return doc.save();
}

// ── Read a filled copy back: exact AcroForm extraction (no AI needed) ──────
async function extractFromFilledPdf(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  let fields;
  try { fields = doc.getForm().getFields(); } catch (_) { return null; }
  if (!fields || !fields.length) return null;

  const out = {};
  const ec = {};
  let answered = 0;
  for (const f of fields) {
    const name = f.getName();
    const kind = f.constructor.name;
    let val;
    try {
      if (kind === 'PDFTextField')      val = (f.getText() || '').trim();
      else if (kind === 'PDFCheckBox')  val = f.isChecked() ? true : null;
      else if (kind === 'PDFRadioGroup') val = f.getSelected() || null;
      else if (kind === 'PDFDropdown') { const s = f.getSelected(); val = (s && s.length) ? s[0] : null; }
    } catch (_) { continue; }
    if (val === null || val === undefined || val === '') continue;
    answered++;
    const m = name.match(/^ec(Name|Role|Phone|Email)_(\d)$/);
    if (m) { (ec[m[2]] ||= {})[m[1].toLowerCase()] = String(val); continue; }
    if (name === 'uniformed') { out.uniformed = (val === 'yes'); continue; }
    out[name] = val;
  }
  const contacts = Object.values(ec).filter(c => c.name || c.phone);
  if (contacts.length) out.emergencyContacts = contacts;
  return answered >= 3 ? out : null;
}

module.exports = { buildIntakePdf, extractFromFilledPdf };
