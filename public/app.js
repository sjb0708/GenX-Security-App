'use strict';

// ── Config & State ────────────────────────────────────────────────────────────
const API = '';
let currentBriefId = null;
let saveTimer = null;
let allBriefs = [];

// ── Mobile sidebar toggle ──────────────────────────────────────────────────────
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobileOverlay');
  if (!sidebar) return;
  const open = sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('visible', open);
}

// Close sidebar when a section nav item is tapped on mobile
document.addEventListener('click', e => {
  if (window.innerWidth <= 768 && e.target.closest('.nav-item')) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatDate(ds) {
  if (!ds) return '—';
  try {
    const d = new Date(ds.includes('T') ? ds : ds + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return ds; }
}

function formatTime(ts) {
  if (!ts) return '';
  const [h, m] = ts.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function val(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked;
  return el.value || '';
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') { el.checked = !!v; }
  else { el.value = v || ''; }
}

function toggleTBD(fieldId) {
  const cb = document.getElementById(fieldId + 'TBD');
  const inp = document.getElementById(fieldId);
  if (!cb || !inp) return;
  if (cb.checked) {
    inp.classList.add('tbd-active');
    inp.disabled = true;
  } else {
    inp.classList.remove('tbd-active');
    inp.disabled = false;
  }
}

function applyTBDState(fieldId, isTbd) {
  const cb = document.getElementById(fieldId + 'TBD');
  if (cb) cb.checked = !!isTbd;
  toggleTBD(fieldId);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 3000) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${esc(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

async function initDashboard() {
  try {
    const res = await fetch(`${API}/api/briefs`);
    allBriefs = await res.json();
    renderDashboard(allBriefs);
  } catch (e) {
    toast('Failed to load briefs', 'error');
  }
}

function renderDashboard(briefs) {
  const grid = document.getElementById('briefsGrid');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('briefCount');

  if (count) count.textContent = briefs.length;

  // Stats
  const statBriefs    = document.getElementById('statBriefs');
  const statVenues    = document.getElementById('statVenues');
  const statShows     = document.getElementById('statShows');
  const statFinalized = document.getElementById('statFinalized');
  const statDraft     = document.getElementById('statDraft');
  if (statBriefs)    statBriefs.textContent    = briefs.length;
  if (statVenues)    statVenues.textContent    = new Set(briefs.map(b => b.venueName).filter(Boolean)).size;
  if (statShows)     statShows.textContent     = briefs.filter(b => b.showDate).length;
  if (statFinalized) statFinalized.textContent = briefs.filter(b => b.status === 'finalized').length;
  if (statDraft)     statDraft.textContent     = briefs.filter(b => !b.status || b.status === 'draft').length;

  if (!grid) return;
  grid.innerHTML = '';

  if (briefs.length === 0) {
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  briefs.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = `brief-card fade-in-up stagger-${Math.min(i + 1, 5)}`;
    card.innerHTML = `
      <div class="brief-card-top"></div>
      <div class="brief-card-body" onclick="window.location='/brief?id=${esc(b.id)}'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <div class="brief-card-venue" style="margin-bottom:0;">${esc(b.venueName || 'Untitled Brief')}</div>
          ${b.showDate ? `<div style="text-align:right;flex-shrink:0;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);">Venue Date</div><div style="font-size:12px;font-weight:700;color:var(--red);">${esc(formatDate(b.showDate))}</div></div>` : ''}
        </div>
        <div class="brief-card-meta">
          ${b.city || b.state ? `<span class="brief-card-location">${esc([b.city, b.state].filter(Boolean).join(', '))}</span>` : ''}
        </div>
        <div class="brief-card-stats" style="grid-template-columns:repeat(4,1fr);">
          <div class="brief-stat">
            <div class="brief-stat-num">${b.talent || 0}</div>
            <div class="brief-stat-lbl">Talent</div>
          </div>
          <div class="brief-stat">
            <div class="brief-stat-num">${b.crew || 0}</div>
            <div class="brief-stat-lbl">Crew</div>
          </div>
          <div class="brief-stat">
            <div class="brief-stat-num">${b.genxSecurity || 0}</div>
            <div class="brief-stat-lbl">GenX Staff</div>
          </div>
          <div class="brief-stat">
            <div class="brief-stat-num">${b.updatedAt ? timeAgo(b.updatedAt) : '—'}</div>
            <div class="brief-stat-lbl">Updated</div>
          </div>
        </div>
      </div>
      ${intakeBadgeHtml(b)}
      <div class="brief-card-footer" id="footer-${esc(b.id)}" style="padding:0 20px 16px;display:flex;align-items:center;justify-content:space-between;">
        <button class="btn btn-sm" onclick="event.stopPropagation();confirmDeleteInline('${esc(b.id)}')" style="background:transparent;border:1px solid rgba(230,57,70,0.3);color:var(--red);padding:6px 8px;" title="Delete brief">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="brief-actions">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();window.location='/brief?id=${esc(b.id)}'">Edit</button>
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();window.location='/view?id=${esc(b.id)}'">View Brief</button>
          ${b.riskScore !== null && b.riskScore !== undefined ? (() => {
            const lvl = b.riskLevel || '';
            const color = lvl === 'Critical' ? '#e63946' : lvl === 'High' ? '#f4845f' : lvl === 'Medium' ? '#e9c46a' : '#57cc99';
            return `<span onclick="event.stopPropagation();window.location='/risk?id=${esc(b.id)}'" title="Risk Assessment: ${esc(lvl)}" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;border:1px solid ${color}33;background:${color}18;cursor:pointer;font-size:11px;font-weight:700;color:${color};line-height:1;">
              <span style="font-size:14px;font-weight:800;">${b.riskScore}</span><span style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.85;">${esc(lvl)}</span>
            </span>`;
          })() : ''}
          <button class="btn btn-sm" onclick="event.stopPropagation();window.location='/risk?id=${esc(b.id)}'" style="background:rgba(230,57,70,0.12);color:var(--red);border:1px solid rgba(230,57,70,0.3);font-weight:700;">⚡ Risk Assessment</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function intakeBadgeHtml(b) {
  if (!b.intakeStatus) {
    return `<div style="padding:8px 20px 12px;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Venue Intake</span>
        <span style="font-size:11px;color:var(--text-3);">— Not sent</span>
        <a href="/brief?id=${esc(b.id)}" onclick="event.stopPropagation();" style="margin-left:auto;font-size:11px;font-weight:700;color:var(--text-3);text-decoration:none;padding:3px 8px;border:1px solid var(--border);border-radius:5px;" onmouseover="this.style.color='var(--text)';this.style.borderColor='var(--border-2)'" onmouseout="this.style.color='var(--text-3)';this.style.borderColor='var(--border)'">Send →</a>
      </div>
    </div>`;
  }
  if (b.intakeStatus === 'pending') {
    const sent = b.intakeSentAt ? new Date(b.intakeSentAt).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
    return `<div style="padding:8px 20px 12px;border-top:1px solid rgba(210,153,34,0.25);background:rgba(210,153,34,0.04);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;color:#d29922;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">⏳ Awaiting Venue</span>
        <span style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;" title="${esc(b.intakeEmail || '')}">${esc(b.intakeEmail || '')}</span>
        ${sent ? `<span style="font-size:10px;color:var(--text-3);margin-left:auto;">Sent ${sent}</span>` : ''}
      </div>
    </div>`;
  }
  if (b.intakeStatus === 'completed') {
    const done = b.intakeDoneAt ? new Date(b.intakeDoneAt).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
    return `<div style="padding:8px 20px 12px;border-top:1px solid rgba(63,185,80,0.25);background:rgba(63,185,80,0.04);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;color:var(--green);font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">✅ Venue Submitted</span>
        <span style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;" title="${esc(b.intakeEmail || '')}">${esc(b.intakeEmail || '')}</span>
        ${done ? `<span style="font-size:10px;color:var(--text-3);margin-left:auto;">Done ${done}</span>` : ''}
      </div>
    </div>`;
  }
  return '';
}

function filterBriefs(q) {
  const filtered = q
    ? allBriefs.filter(b =>
        (b.venueName || '').toLowerCase().includes(q.toLowerCase()) ||
        (b.city || '').toLowerCase().includes(q.toLowerCase()) ||
        (b.state || '').toLowerCase().includes(q.toLowerCase()))
    : allBriefs;
  renderDashboard(filtered);
}

async function createNewBrief() {
  try {
    const res = await fetch(`${API}/api/briefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    window.location = `/brief?id=${data.id}`;
  } catch (e) {
    toast('Failed to create brief', 'error');
  }
}

function confirmDeleteInline(id) {
  const footer = document.getElementById('footer-' + id);
  if (!footer) return;
  footer.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;width:100%;justify-content:space-between;">
      <span style="font-size:12px;font-weight:600;color:var(--red);">Are you sure you want to delete this brief?</span>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();renderDashboard(allBriefs)">Cancel</button>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;border-color:var(--red);font-weight:700;" onclick="event.stopPropagation();doDeleteBrief('${id}')">Yes, Delete</button>
      </div>
    </div>`;
}

async function doDeleteBrief(id) {
  try {
    await fetch(`${API}/api/briefs/${id}`, { method: 'DELETE' });
    allBriefs = allBriefs.filter(b => b.id !== id);
    renderDashboard(allBriefs);
    toast('Brief deleted', 'success');
  } catch (e) {
    toast('Delete failed', 'error');
  }
}

async function duplicateBrief(id) {
  try {
    const res = await fetch(`${API}/api/briefs/${id}`);
    const brief = await res.json();
    delete brief.id;
    if (brief.venue) brief.venue.name = (brief.venue.name || 'Untitled') + ' (Copy)';
    const res2 = await fetch(`${API}/api/briefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) });
    const data = await res2.json();
    window.location = `/brief?id=${data.id}`;
  } catch (e) {
    toast('Duplicate failed', 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BRIEF BUILDER
// ══════════════════════════════════════════════════════════════════════════════

async function initBriefBuilder(id) {
  if (id) {
    currentBriefId = id;
    try {
      const res = await fetch(`${API}/api/briefs/${id}`);
      if (!res.ok) throw new Error('Not found');
      const brief = await res.json();
      populateBrief(brief);
      const viewBtn = document.getElementById('viewBriefBtn');
      if (viewBtn) { viewBtn.href = `/view?id=${id}`; viewBtn.style.display = ''; }
      updateFinalizeBtn(brief.status);
      if (typeof initVenueIntakeUI  === 'function') initVenueIntakeUI(brief);
      if (typeof initTravelSection  === 'function') initTravelSection(brief);
    } catch (e) {
      toast('Failed to load brief', 'error');
    }
  } else {
    initBlankROSAndPeople();
  }
  initSidebarSpy();
}

function populateBrief(b) {
  // Venue
  setVal('venueName',    b.venue?.name);
  setVal('venueStreet',  b.venue?.street);
  setVal('venueCity',    b.venue?.city);
  setVal('venueState',   b.venue?.state);
  setVal('venueZip',     b.venue?.zip);
  setVal('venuePhone',   b.venue?.phone);
  setVal('venueCapacity',b.venue?.capacity);
  setVal('venueTotalTicketed',b.venue?.totalTicketed);
  setVal('venueType',         b.venue?.type);
  setVal('venueContactEmail', b.venue?.contactEmail);
  updateMapsButtons(); updateNav();

  // Hotel
  setVal('hotelName',        b.hotel?.name);
  setVal('hotelStreet',      b.hotel?.street);
  setVal('hotelCity',        b.hotel?.city);
  setVal('hotelState',       b.hotel?.state);
  setVal('hotelZip',         b.hotel?.zip);
  setVal('hotelPhone',       b.hotel?.phone);
  setVal('hotelCheckin',     b.hotel?.checkin);
  setVal('hotelCheckinTime', b.hotel?.checkinTime);
  setVal('hotelCheckout',    b.hotel?.checkout);
  setVal('hotelCheckoutTime',b.hotel?.checkoutTime);

  // Timeline
  setVal('arrivalDate',   b.timeline?.arrivalDate);
  setVal('arrivalTime',   b.timeline?.arrivalTime);
  setVal('mediaDate',     b.timeline?.mediaDate);
  setVal('mediaTime',     b.timeline?.mediaTime);
  setVal('showDate',      b.timeline?.showDate);
  setVal('doorsTime',     b.timeline?.doorsTime);
  setVal('showTime',      b.timeline?.showTime);
  setVal('departureDate', b.timeline?.departureDate);
  setVal('departureTime', b.timeline?.departureTime);
  setVal('timelineNotes', b.timeline?.notes);
  // Restore TBD states
  applyTBDState('arrivalDate',   b.timeline?.arrivalDateTBD);
  applyTBDState('arrivalTime',   b.timeline?.arrivalTimeTBD);
  applyTBDState('mediaDate',     b.timeline?.mediaDateTBD);
  applyTBDState('mediaTime',     b.timeline?.mediaTimeTBD);
  applyTBDState('showDate',      b.timeline?.showDateTBD);
  applyTBDState('doorsTime',     b.timeline?.doorsTimeTBD);
  applyTBDState('showTime',      b.timeline?.showTimeTBD);
  applyTBDState('departureDate', b.timeline?.departureDateTBD);
  applyTBDState('departureTime', b.timeline?.departureTimeTBD);
  renderTimeline();

  // Contacts
  setVal('primaryName',  b.contacts?.primary?.name);
  setVal('primaryTitle', b.contacts?.primary?.title);
  setVal('primaryEmail', b.contacts?.primary?.email);
  setVal('primaryPhone', b.contacts?.primary?.phone);
  setVal('primaryCell',  b.contacts?.primary?.cell);
  setVal('backupName',   b.contacts?.backup?.name);
  setVal('backupTitle',  b.contacts?.backup?.title);
  setVal('backupEmail',  b.contacts?.backup?.email);
  setVal('backupPhone',  b.contacts?.backup?.phone);
  setVal('backupCell',   b.contacts?.backup?.cell);

  // Ingress
  const ing = b.ingress || {};
  setVal('chkMag',      ing.magnetometer);
  setVal('chkBag',      ing.bagCheck);
  setVal('chkWand',     ing.wand);
  setVal('chkPatDown',  ing.patDown);
  setVal('chkVisual',   ing.visualInspection);
  setVal('chkEvolv',    ing.evolv);
  setVal('ticketingType', ing.ticketingType);
  setVal('gateCount',     ing.gateCount);
  setVal('gateOpenTime',  ing.gateOpenTime);
  setVal('ingressNotes',  ing.notes);
  if (ing.prohibitedItems?.length) {
    ing.prohibitedItems.forEach(t => addTag('prohibitedTagsWrap', t));
  }

  // Staffing
  const st = b.staffing || {};
  setVal('totalSecurity',    st.totalSecurity);
  setVal('ushers',           st.ushers);
  setVal('leoCount',         st.leo);
  setVal('backstageSecurity',st.backstageSecurity);
  setVal('uniformed',        st.uniformed);
  setVal('uniformDesc',      st.uniformDesc);
  setVal('staffingNotes',    st.notes);
  if (st.uniformed) { const w = document.getElementById('uniformDescWrap'); if (w) w.style.display = ''; }

  // Medical
  const med = b.medical || {};
  setVal('medicalOnSite',        med.onSite);
  setVal('firstResponderCount',  med.firstResponderCount);
  setVal('aedOnSite',            med.aedOnSite);
  setVal('aedNearStage',         med.aedNearStage);
  setVal('firstAidLocations',    med.firstAidLocations);
  setVal('emergencyProtocol',    med.emergencyProtocol);
  setVal('hospitalName',         med.hospitalName);
  setVal('hospitalAddress',      med.hospitalAddress);
  setVal('hospitalPhone',        med.hospitalPhone);
  setVal('announcementMethod',   med.announcementMethod);

  // Evacuation
  const evac = b.evacuation || {};
  setVal('primaryExit',      evac.primaryExit);
  setVal('secondaryExit',    evac.secondaryExit);
  setVal('rallyPoint',       evac.rallyPoint);
  setVal('eapNotes',         evac.eapNotes);
  setVal('lockdownProtocol', evac.lockdownProtocol);
  if (evac.safeRooms?.length) evac.safeRooms.forEach(t => addTag('safeRoomsWrap', t));

  // Meet & Greet
  const mg = b.meetgreet || {};
  setVal('mgScheduled', mg.scheduled);
  setVal('mgTime',      mg.time);
  setVal('mgDuration',  mg.duration);
  setVal('mgLocation',  mg.location);
  setVal('mgTotalVips', mg.totalVips);
  setVal('mgStaff',     mg.staffAssigned);
  setVal('mgGenxStaff', mg.genxStaff);
  setVal('mgProtocol',  mg.protocol);
  setVal('giftPolicy',  mg.giftPolicy);

  // Communications
  const comms = b.communications || {};
  setVal('venueShareComms', comms.venueShareComms);
  setVal('securityOps',     comms.securityOps);
  setVal('securityOpsPhone',comms.securityOpsPhone);
  setVal('cellOk',          comms.cellOk);
  setVal('commsNotes',      comms.notes);
  renderChannels(comms.channels || []);

  // Access
  const acc = b.access || {};
  // GenX dedicated credential badge
  setGenxCredSlot('genxCredFront', 'genxCredFrontUrl', acc.genxCred?.frontImage || '');
  setGenxCredSlot('genxCredBack',  'genxCredBackUrl',  acc.genxCred?.backImage  || '');
  setVal('genxCredName',     acc.genxCred?.name     || '');
  setVal('genxCredIssuedBy', acc.genxCred?.issuedBy || '');
  setVal('genxCredNotes',    acc.genxCred?.notes    || '');
  setVal('doorCardAccess', acc.doorSystems?.includes('Card Access'));
  setVal('doorFacial',     acc.doorSystems?.includes('Facial Recognition'));
  setVal('doorPin',        acc.doorSystems?.includes('PIN'));
  setVal('doorKey',        acc.doorSystems?.includes('Key'));
  setVal('doorFob',        acc.doorSystems?.includes('Fob'));
  setVal('doorOther',      acc.doorSystems?.includes('Other'));
  setVal('parkingNotes',   acc.parkingNotes);
  renderCredentials(acc.credentials || []);

  // Load In/Out
  const li = b.loadinout || {};
  setVal('dockLocation',  li.dockLocation);
  setVal('loadinDate',    li.loadinDate);
  setVal('loadinTime',    li.loadinTime);
  setVal('loadinNotes',   li.loadinNotes);
  setVal('loadoutDate',   li.loadoutDate);
  setVal('loadoutTime',   li.loadoutTime);
  setVal('loadoutNotes',  li.loadoutNotes);
  setVal('vehicleCount',  li.vehicleCount);
  setVal('securityAtDock',li.securityAtDock);

  // Run of Show
  renderROSTable(b.runofshow || []);

  // Talent & Crew
  renderPersonGrid(b.talent || [], 'talentGrid', 'talent');
  renderPersonGrid(b.crew   || [], 'crewGrid',   'crew');

  // GenX Security Staff
  renderGenxStaffGrid(b.genxstaff || []);

  // Emergency
  renderEmergency(b.emergency || []);

  // Maps
  renderMaps(b.maps || []);

  // Status bar
  updateStatusBar(b.venue?.name);
}

function initBlankROSAndPeople() {
  renderROSTable([]);
  renderPersonGrid([], 'talentGrid', 'talent');
  renderPersonGrid([], 'crewGrid', 'crew');
  renderGenxStaffGrid([]);
  renderEmergency([]);
  renderMaps([]);
  renderChannels([]);
  renderCredentials([]);
  renderGenxCredentials([]);
}

// ── Collect all form data ─────────────────────────────────────────────────────

function collectBrief() {
  return {
    venue: {
      name:     val('venueName'),
      street:   val('venueStreet'),
      city:     val('venueCity'),
      state:    val('venueState'),
      zip:      val('venueZip'),
      phone:    val('venuePhone'),
      capacity: val('venueCapacity'),
      totalTicketed: val('venueTotalTicketed'),
      type:         val('venueType'),
      contactEmail: val('venueContactEmail')
    },
    hotel: {
      name:        val('hotelName'),
      street:      val('hotelStreet'),
      city:        val('hotelCity'),
      state:       val('hotelState'),
      zip:         val('hotelZip'),
      phone:       val('hotelPhone'),
      checkin:     val('hotelCheckin'),
      checkinTime: val('hotelCheckinTime'),
      checkout:    val('hotelCheckout'),
      checkoutTime:val('hotelCheckoutTime')
    },
    timeline: {
      arrivalDate:      val('arrivalDate'),
      arrivalDateTBD:   val('arrivalDateTBD'),
      arrivalTime:      val('arrivalTime'),
      arrivalTimeTBD:   val('arrivalTimeTBD'),
      mediaDate:        val('mediaDate'),
      mediaDateTBD:     val('mediaDateTBD'),
      mediaTime:        val('mediaTime'),
      mediaTimeTBD:     val('mediaTimeTBD'),
      showDate:         val('showDate'),
      showDateTBD:      val('showDateTBD'),
      doorsTime:        val('doorsTime'),
      doorsTimeTBD:     val('doorsTimeTBD'),
      showTime:         val('showTime'),
      showTimeTBD:      val('showTimeTBD'),
      departureDate:    val('departureDate'),
      departureDateTBD: val('departureDateTBD'),
      departureTime:    val('departureTime'),
      departureTimeTBD: val('departureTimeTBD'),
      notes:            val('timelineNotes')
    },
    contacts: {
      primary: {
        name:  val('primaryName'),
        title: val('primaryTitle'),
        email: val('primaryEmail'),
        phone: val('primaryPhone'),
        cell:  val('primaryCell')
      },
      backup: {
        name:  val('backupName'),
        title: val('backupTitle'),
        email: val('backupEmail'),
        phone: val('backupPhone'),
        cell:  val('backupCell')
      }
    },
    ingress: {
      magnetometer:    val('chkMag'),
      bagCheck:        val('chkBag'),
      wand:            val('chkWand'),
      patDown:         val('chkPatDown'),
      visualInspection:val('chkVisual'),
      evolv:           val('chkEvolv'),
      ticketingType:   val('ticketingType'),
      gateCount:       val('gateCount'),
      gateOpenTime:    val('gateOpenTime'),
      notes:           val('ingressNotes'),
      prohibitedItems: getTagValues('prohibitedTagsWrap')
    },
    staffing: {
      totalSecurity:    val('totalSecurity'),
      ushers:           val('ushers'),
      leo:              val('leoCount'),
      backstageSecurity:val('backstageSecurity'),
      genxSecurity:     val('genxSecurity'),
      uniformed:        val('uniformed'),
      uniformDesc:      val('uniformDesc'),
      notes:            val('staffingNotes')
    },
    medical: {
      onSite:              val('medicalOnSite'),
      firstResponderCount: val('firstResponderCount'),
      aedOnSite:           val('aedOnSite'),
      aedNearStage:        val('aedNearStage'),
      firstAidLocations:   val('firstAidLocations'),
      emergencyProtocol:   val('emergencyProtocol'),
      hospitalName:        val('hospitalName'),
      hospitalAddress:     val('hospitalAddress'),
      hospitalPhone:       val('hospitalPhone'),
      announcementMethod:  val('announcementMethod')
    },
    evacuation: {
      primaryExit:      val('primaryExit'),
      secondaryExit:    val('secondaryExit'),
      safeRooms:        getTagValues('safeRoomsWrap'),
      rallyPoint:       val('rallyPoint'),
      eapNotes:         val('eapNotes'),
      lockdownProtocol: val('lockdownProtocol')
    },
    meetgreet: {
      scheduled:    val('mgScheduled'),
      time:         val('mgTime'),
      duration:     val('mgDuration'),
      location:     val('mgLocation'),
      totalVips:    val('mgTotalVips'),
      staffAssigned:val('mgStaff'),
      genxStaff:    val('mgGenxStaff'),
      protocol:     val('mgProtocol'),
      giftPolicy:   val('giftPolicy')
    },
    communications: {
      venueShareComms:  val('venueShareComms'),
      channels:         collectChannels(),
      securityOps:      val('securityOps'),
      securityOpsPhone: val('securityOpsPhone'),
      cellOk:           val('cellOk'),
      notes:            val('commsNotes')
    },
    access: {
      doorSystems:      collectDoorSystems(),
      credentials:      collectCredentials(),
      genxCred: {
        frontImage: document.getElementById('genxCredFrontUrl')?.value || '',
        backImage:  document.getElementById('genxCredBackUrl')?.value  || '',
        name:       val('genxCredName'),
        issuedBy:   val('genxCredIssuedBy'),
        notes:      val('genxCredNotes')
      },
      parkingNotes:     val('parkingNotes')
    },
    loadinout: {
      dockLocation:  val('dockLocation'),
      loadinDate:    val('loadinDate'),
      loadinTime:    val('loadinTime'),
      loadinNotes:   val('loadinNotes'),
      loadoutDate:   val('loadoutDate'),
      loadoutTime:   val('loadoutTime'),
      loadoutNotes:  val('loadoutNotes'),
      vehicleCount:  val('vehicleCount'),
      securityAtDock:val('securityAtDock')
    },
    runofshow:  collectROS(),
    talent:     collectPersonGrid('talentGrid'),
    crew:       collectPersonGrid('crewGrid'),
    genxstaff:  collectGenxStaff(),
    emergency:  collectEmergency(),
    maps:       collectMaps(),
    travel:     window._travelersData || []
  };
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

function scheduleSave() {
  setStatus('Unsaved…', false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 900);
}

async function doSave() {
  if (!currentBriefId) return;
  setStatus('Saving…', false);
  try {
    const data = collectBrief();
    const res = await fetch(`${API}/api/briefs/${currentBriefId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Save failed');
    setStatus('Saved ✓', true);
    updateDots();
  } catch (e) {
    setStatus('Save failed', false);
  }
}

function setStatus(text, ok) {
  const t = document.getElementById('statusText');
  const d = document.getElementById('statusDot');
  if (t) t.textContent = text;
  if (d) { d.style.background = ok ? 'var(--green)' : 'var(--gold)'; }
}

function updateNav() {
  const n = val('venueName');
  const navEl = document.getElementById('navVenueName');
  const statusEl = document.getElementById('statusVenueName');
  if (navEl) navEl.textContent = n || 'New Brief';
  if (statusEl) statusEl.textContent = n ? `— ${n}` : '';
}

function updateStatusBar(name) {
  updateNav();
  setStatus('Ready', true);
}

let _briefStatus = 'draft';
function updateFinalizeBtn(status) {
  _briefStatus = status || 'draft';
  const btn = document.getElementById('finalizeBtn');
  if (!btn) return;
  btn.style.display = '';
  if (_briefStatus === 'finalized') {
    btn.textContent = '✓ Finalized';
    btn.style.background = 'rgba(34,197,94,0.15)';
    btn.style.color = '#22c55e';
    btn.style.borderColor = 'rgba(34,197,94,0.4)';
  } else {
    btn.textContent = 'Mark Finalized';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

async function toggleFinalized() {
  _briefStatus = _briefStatus === 'finalized' ? 'draft' : 'finalized';
  updateFinalizeBtn(_briefStatus);
  if (!currentBriefId) return;
  try {
    const res = await fetch(`${API}/api/briefs/${currentBriefId}`);
    const brief = await res.json();
    brief.status = _briefStatus;
    await fetch(`${API}/api/briefs/${currentBriefId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(brief)
    });
    toast(_briefStatus === 'finalized' ? 'Brief finalized' : 'Marked as draft', 'success');
  } catch (e) {
    toast('Failed to update status', 'error');
  }
}

// ── Maps Buttons ──────────────────────────────────────────────────────────────

function updateMapsButtons() {
  const addr = [val('venueStreet'), val('venueCity'), val('venueState'), val('venueZip')].filter(Boolean).join(', ');
  const row = document.getElementById('maps-buttons');
  if (!row) return;
  if (!addr.replace(/,\s*/g, '')) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  const enc = encodeURIComponent(addr);
  const gm = document.getElementById('btn-gmaps');
  const wz = document.getElementById('btn-waze');
  if (gm) gm.href = `https://www.google.com/maps/search/?api=1&query=${enc}`;
  if (wz) wz.href = `https://waze.com/ul?q=${enc}`;
}

// ── Uniform toggle ────────────────────────────────────────────────────────────

function toggleUniformDesc() {
  const w = document.getElementById('uniformDescWrap');
  if (w) w.style.display = val('uniformed') ? '' : 'none';
}

// ── Timeline Visual ───────────────────────────────────────────────────────────

function renderTimeline() {
  const wrap = document.getElementById('timelineVisualWrap');
  const container = document.getElementById('timelineVisual');
  if (!wrap || !container) return;

  const isTBD = id => { const el = document.getElementById(id + 'TBD'); return el && el.checked; };
  const events = [
    { label: 'Arrival',   date: val('arrivalDate'),   time: val('arrivalTime'),   dateTBD: isTBD('arrivalDate'),   timeTBD: isTBD('arrivalTime')   },
    { label: 'Media Day', date: val('mediaDate'),     time: val('mediaTime'),     dateTBD: isTBD('mediaDate'),     timeTBD: isTBD('mediaTime')     },
    { label: 'Show Day',  date: val('showDate'),      time: val('showTime'),      dateTBD: isTBD('showDate'),      timeTBD: isTBD('showTime')      },
    { label: 'Departure', date: val('departureDate'), time: val('departureTime'), dateTBD: isTBD('departureDate'), timeTBD: isTBD('departureTime') }
  ].filter(e => e.date || e.dateTBD);

  if (events.length < 2) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  container.innerHTML = `
    <div class="timeline-track">
      <div class="timeline-line-bg"></div>
      ${events.map((e, i) => `
        <div class="timeline-event${i === 0 || i === events.length - 1 ? '' : ''}">
          <div class="timeline-dot"></div>
          <div class="timeline-label">${esc(e.label)}</div>
          <div class="timeline-value">${e.dateTBD ? '<span style="color:var(--text-3);font-style:italic;">TBD</span>' : esc(formatDate(e.date))}</div>
          ${e.timeTBD ? `<div class="timeline-sublabel" style="color:var(--text-3);font-style:italic;">TBD</div>` : (e.time ? `<div class="timeline-sublabel">${esc(formatTime(e.time))}</div>` : '')}
        </div>`).join('')}
    </div>`;
}

// ── Tag Inputs ────────────────────────────────────────────────────────────────

function handleTagKey(e, wrapId, inputId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById(inputId);
    const text = input.value.trim();
    if (text) { addTag(wrapId, text); input.value = ''; scheduleSave(); }
  }
}

function addTag(wrapId, text) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.dataset.value = text;
  chip.innerHTML = `${esc(text)}<span class="tag-chip-remove" onclick="this.parentElement.remove();scheduleSave()">×</span>`;
  const input = wrap.querySelector('.tag-input-field');
  wrap.insertBefore(chip, input);
}

function getTagValues(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return [];
  return [...wrap.querySelectorAll('.tag-chip')].map(c => c.dataset.value || c.textContent.replace('×', '').trim());
}

// ── Radio Channels ────────────────────────────────────────────────────────────

function renderChannels(channels) {
  const grid = document.getElementById('channelGrid');
  if (!grid) return;
  grid.innerHTML = '';
  channels.forEach(ch => addChannelRow(ch));
}

function addChannelRow(ch = {}) {
  const grid = document.getElementById('channelGrid');
  if (!grid) return;
  const row = document.createElement('div');
  row.className = 'channel-row';
  row.innerHTML = `
    <div class="channel-num"><input style="width:28px;background:transparent;border:none;outline:none;color:var(--red);font-weight:800;font-size:12px;font-family:Montserrat,sans-serif;text-align:center;" value="${esc(ch.ch || '')}" placeholder="#" oninput="scheduleSave()"></div>
    <input class="channel-use" style="background:transparent;border:none;outline:none;color:var(--text-2);font-size:12px;font-family:Montserrat,sans-serif;flex:1;" value="${esc(ch.use || '')}" placeholder="Channel use…" oninput="scheduleSave()">
    <button style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:14px;padding:0 0 0 6px;" onclick="this.parentElement.remove();scheduleSave()">×</button>`;
  grid.appendChild(row);
}

function addRadioChannel() {
  addChannelRow({});
  scheduleSave();
}

function collectChannels() {
  const grid = document.getElementById('channelGrid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.channel-row')].map(row => {
    const inputs = row.querySelectorAll('input');
    return { ch: inputs[0]?.value || '', use: inputs[1]?.value || '' };
  });
}

// ── Credentials ───────────────────────────────────────────────────────────────

function renderCredentials(creds) {
  const body = document.getElementById('credentialsBody');
  if (!body) return;
  body.innerHTML = '';
  creds.forEach(c => addCredentialRow(c));
}

function addCredentialRow(c = {}) {
  const body = document.getElementById('credentialsBody');
  if (!body) return;
  const tr = document.createElement('tr');
  const imgHtml = c.image
    ? `<img src="${esc(c.image)}" style="width:44px;height:44px;object-fit:cover;border-radius:4px;cursor:pointer;display:block;" onclick="this.nextElementSibling.click()"><input type="file" accept="image/*" style="display:none;" onchange="handleCredentialImageUpload(this)">`
    : `<label style="cursor:pointer;font-size:10px;color:var(--text-3);white-space:nowrap;display:flex;align-items:center;gap:3px;">📎 Photo<input type="file" accept="image/*" style="display:none;" onchange="handleCredentialImageUpload(this)"></label>`;
  tr.innerHTML = `
    <td><input class="inline-input" value="${esc(c.name || '')}" placeholder="Credential name" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(c.color || '')}" placeholder="Color" style="max-width:90px;" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(c.level || '')}" placeholder="Access level" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(c.location || '')}" placeholder="Location" oninput="scheduleSave()"></td>
    <td class="cred-img-cell" style="width:64px;text-align:center;">${imgHtml}</td>
    <td><button class="btn btn-icon btn-ghost btn-xs" onclick="this.closest('tr').remove();scheduleSave()">×</button></td>`;
  body.appendChild(tr);
}

function handleCredentialImageUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const td = input.closest('.cred-img-cell');
  const fd = new FormData();
  fd.append('file', file);
  fetch(`${API}/api/upload`, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.url && td) {
        td.innerHTML = `<img src="${esc(data.url)}" style="width:44px;height:44px;object-fit:cover;border-radius:4px;cursor:pointer;display:block;" onclick="this.nextElementSibling.click()"><input type="file" accept="image/*" style="display:none;" onchange="handleCredentialImageUpload(this)">`;
        scheduleSave();
      }
    })
    .catch(() => toast('Upload failed', 'error'));
}

// ── GenX Security Credentials (dedicated badge section) ───────────────────────

let _pickerIsCred = false;
let _credSlotDivId = null;
let _credSlotUrlId  = null;

function setGenxCredSlot(divId, urlId, url) {
  const div = document.getElementById(divId);
  const inp = document.getElementById(urlId);
  if (!div || !inp) return;
  inp.value = url;
  if (url) {
    div.innerHTML = `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
    div.style.borderColor = 'transparent';
  } else {
    const side = divId.includes('Front') ? 'front' : 'back';
    div.innerHTML = `<div style="text-align:center;padding:12px;"><div style="font-size:28px;margin-bottom:6px;">🪪</div><div style="font-size:11px;color:var(--text-3);font-weight:600;">Tap to add<br>${side} image</div></div>`;
    div.style.borderColor = 'var(--border-2)';
  }
}

function openPhotoPickerForCredSlot(divId, urlId) {
  _pickerIsCred  = true;
  _credSlotDivId = divId;
  _credSlotUrlId = urlId;
  const overlay = document.getElementById('photoPickerOverlay');
  overlay.style.display = 'flex';
  loadPickerPhotos();
}

function collectDoorSystems() {
  const systems = [];
  if (val('doorCardAccess')) systems.push('Card Access');
  if (val('doorFacial'))     systems.push('Facial Recognition');
  if (val('doorPin'))        systems.push('PIN');
  if (val('doorKey'))        systems.push('Key');
  if (val('doorFob'))        systems.push('Fob');
  if (val('doorOther'))      systems.push('Other');
  return systems;
}

function collectCredentials() {
  const body = document.getElementById('credentialsBody');
  if (!body) return [];
  return [...body.querySelectorAll('tr')].map(tr => {
    const inputs = [...tr.querySelectorAll('input:not([type=file])')];
    const img = tr.querySelector('.cred-img-cell img');
    return { name: inputs[0]?.value || '', color: inputs[1]?.value || '', level: inputs[2]?.value || '', location: inputs[3]?.value || '', image: img?.getAttribute('src') || '' };
  });
}

// ── Run of Show ───────────────────────────────────────────────────────────────

function renderROSTable(rows) {
  const body = document.getElementById('rosBody');
  if (!body) return;
  body.innerHTML = '';
  rows.forEach(r => addROSRow(r));
}

function addROSRow(r = {}) {
  const body = document.getElementById('rosBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.className = 'ros-row' + (r.critical ? ' ros-row-critical' : '');
  tr.draggable = true;
  tr.innerHTML = `
    <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
    <td><input class="ros-time-input" type="time" value="${esc(r.time || '')}" oninput="scheduleSave()"></td>
    <td><input class="ros-text-input" value="${esc(r.activity || '')}" placeholder="Activity description…" oninput="scheduleSave()"></td>
    <td><input class="ros-text-input" value="${esc(r.notes || '')}" placeholder="Security notes…" oninput="scheduleSave()"></td>
    <td style="text-align:center;">
      <label class="toggle" style="width:34px;height:18px;">
        <input type="checkbox" ${r.critical ? 'checked' : ''} onchange="this.closest('tr').className='ros-row'+(this.checked?' ros-row-critical':'');scheduleSave()">
        <span class="toggle-slider" style="border-radius:18px;"></span>
      </label>
    </td>
    <td><button class="btn btn-icon btn-ghost btn-xs" onclick="this.closest('tr').remove();scheduleSave()" title="Delete row">×</button></td>`;
  body.appendChild(tr);
  initROSDrag(tr);
}

function collectROS() {
  const body = document.getElementById('rosBody');
  if (!body) return [];
  return [...body.querySelectorAll('tr.ros-row')].map(tr => {
    const inputs = tr.querySelectorAll('input');
    return {
      time:     inputs[0]?.value || '',
      activity: inputs[1]?.value || '',
      notes:    inputs[2]?.value || '',
      critical: inputs[3]?.checked || false
    };
  });
}

// ROS drag-and-drop
let dragSrc = null;
function initROSDrag(tr) {
  tr.addEventListener('dragstart', e => { dragSrc = tr; tr.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  tr.addEventListener('dragend',   () => { if (dragSrc) dragSrc.classList.remove('dragging'); dragSrc = null; document.querySelectorAll('.ros-row.drag-over').forEach(r => r.classList.remove('drag-over')); });
  tr.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; tr.classList.add('drag-over'); });
  tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
  tr.addEventListener('drop',      e => { e.preventDefault(); tr.classList.remove('drag-over'); if (dragSrc && dragSrc !== tr) { const body = tr.parentNode; const rows = [...body.children]; const srcIdx = rows.indexOf(dragSrc); const tgtIdx = rows.indexOf(tr); body.insertBefore(dragSrc, srcIdx < tgtIdx ? tr.nextSibling : tr); scheduleSave(); } });
}

// ── Person Cards (Talent/Crew) ────────────────────────────────────────────────

function renderPersonGrid(people, gridId, type) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  people.forEach(p => addPersonCard(p, type));
}

function addPersonCard(p = {}, type) {
  const gridId = type === 'talent' ? 'talentGrid' : 'crewGrid';
  const grid = document.getElementById(gridId);
  if (!grid) return;

  const div = document.createElement('div');
  div.className = 'person-card';
  div.dataset.type = type;

  const initials = getInitials(p.name || '');
  const photoHtml = p.photo
    ? `<img src="${esc(p.photo)}" alt="">`
    : `<span>${initials || '?'}</span>`;

  const isTalent = type === 'talent';

  div.innerHTML = `
    <button class="person-card-remove" onclick="this.closest('.person-card').remove();scheduleSave()" title="Remove">×</button>
    <div class="person-photo-wrap">
      <div class="person-photo" onclick="event.stopPropagation();openPhotoPicker(this)">
        ${photoHtml}
        <div class="person-photo-overlay">📷</div>
      </div>
    </div>
    <input class="person-name-input" value="${esc(p.name || '')}" placeholder="Full Name" oninput="updateInitials(this);scheduleSave()">
    ${isTalent ? `<input class="person-stage-input" value="${esc(p.stageName || '')}" placeholder="Stage Name" oninput="scheduleSave()">` : ''}
    <input class="person-role-input" value="${esc(isTalent ? (p.role || '') : (p.function || ''))}" placeholder="${isTalent ? 'Role' : 'Function'}" oninput="scheduleSave()">
    ${!isTalent ? `<input class="person-role-input" style="color:var(--text-2);font-size:11px;" value="${esc(p.phone || '')}" placeholder="Phone" oninput="scheduleSave()">` : ''}
    <textarea class="person-notes-input" placeholder="Notes…" oninput="scheduleSave()">${esc(p.notes || '')}</textarea>`;

  grid.appendChild(div);
}

function updateInitials(input) {
  const card = input.closest('.person-card');
  const photoDiv = card?.querySelector('.person-photo');
  const img = photoDiv?.querySelector('img');
  if (!img) {
    const span = photoDiv?.querySelector('span');
    if (span) span.textContent = getInitials(input.value);
  }
}

// ── Photo Library Picker ──────────────────────────────────────────────────────

let _pickerTarget = null; // the .person-photo div that was clicked

function openPhotoPicker(photoDiv) {
  _pickerTarget  = photoDiv;
  _pickerIsCred  = false;
  _credSlotDivId = null;
  _credSlotUrlId  = null;
  const overlay = document.getElementById('photoPickerOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _pickerJustOpened = true;
  loadPickerPhotos();
}

function closePhotoPicker() {
  const overlay = document.getElementById('photoPickerOverlay');
  if (overlay) overlay.style.display = 'none';
  _pickerTarget = null;
}

// Close picker when clicking the dark backdrop (not the modal box itself)
document.getElementById('photoPickerOverlay')?.addEventListener('click', e => {
  if (e.target === document.getElementById('photoPickerOverlay')) closePhotoPicker();
});

async function loadPickerPhotos() {
  const grid   = document.getElementById('pickerGrid');
  const empty  = document.getElementById('pickerEmpty');
  const loading= document.getElementById('pickerLoading');
  if (!grid) return;

  if (loading) loading.style.display = '';
  grid.innerHTML = '';
  if (empty) empty.style.display = 'none';

  try {
    const res    = await fetch(`${API}/api/photos`);
    const photos = await res.json();
    if (loading) loading.style.display = 'none';

    if (!Array.isArray(photos) || photos.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }

    grid.innerHTML = photos.map(p => `
      <div onclick="selectPickerPhoto('${esc(p.id)}','${esc(p.url)}')"
           style="cursor:pointer;border-radius:10px;overflow:hidden;border:2px solid transparent;aspect-ratio:1;transition:border-color 0.15s,transform 0.1s;"
           onmouseover="this.style.borderColor='var(--red)';this.style.transform='scale(1.04)'"
           onmouseout="this.style.borderColor='transparent';this.style.transform='scale(1)'"
           title="${esc(p.name)}">
        <img src="${esc(p.url)}" style="width:100%;height:100%;object-fit:cover;display:block;" alt="${esc(p.name)}">
      </div>`).join('');
  } catch (e) {
    if (loading) loading.style.display = 'none';
    if (grid) grid.innerHTML = `<div style="color:var(--red);font-size:13px;text-align:center;padding:20px;">Error: ${e.message}</div>`;
  }
}

function selectPickerPhoto(id, url) {
  if (_pickerIsCred && _credSlotDivId) {
    setGenxCredSlot(_credSlotDivId, _credSlotUrlId, url);
    _pickerIsCred  = false;
    _credSlotDivId = null;
    _credSlotUrlId  = null;
  } else if (_pickerTarget) {
    _pickerTarget.innerHTML = `<img src="${esc(url)}" alt=""><div class="person-photo-overlay">📷</div>`;
  }
  closePhotoPicker();
  scheduleSave();
}

async function pickerUploadNew(files) {
  if (!files || files.length === 0) return;
  const fd = new FormData();
  [...files].forEach(f => fd.append('files', f));
  try {
    const res  = await fetch(`${API}/api/photos`, { method: 'POST', body: fd });
    const data = await res.json();
    toast(`${data.added} photo${data.added !== 1 ? 's' : ''} added to library`, 'success');
    loadPickerPhotos();
  } catch (e) {
    toast('Upload failed', 'error');
  }
}

function collectPersonGrid(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return [];
  return [...grid.querySelectorAll('.person-card')].map(card => {
    const inputs = [...card.querySelectorAll('input')];
    const textarea = card.querySelector('textarea');
    const img = card.querySelector('.person-photo img');
    const type = card.dataset.type;
    if (type === 'talent') {
      return { name: inputs[0]?.value || '', stageName: inputs[1]?.value || '', role: inputs[2]?.value || '', notes: textarea?.value || '', photo: img?.getAttribute('src') || '' };
    } else {
      return { name: inputs[0]?.value || '', function: inputs[1]?.value || '', phone: inputs[2]?.value || '', notes: textarea?.value || '', photo: img?.getAttribute('src') || '' };
    }
  });
}

// ── GenX Security Staff ───────────────────────────────────────────────────────

const CERT_OPTIONS = ['', 'First Aid', 'Med.Resp', 'EMT', 'CPR', 'Medic', 'HR-218'];

const GENX_ROLE_OPTIONS = [
  '',
  'Security Lead',
  'Security',
  'Advance Security',
  'Close Protection',
  'Crowd Management',
  'Access Control',
  'Stage Security',
  'Backstage Security',
  'Perimeter Security',
  'Command Post',
  'Driver / Transportation',
  'Medical Support',
  'K-9 Handler',
  'Supervisor',
  'Other',
];

function renderGenxStaffGrid(staff) {
  const grid = document.getElementById('genxStaffGrid');
  if (!grid) return;
  grid.innerHTML = '';
  (staff || []).forEach(p => addGenxStaffCard(p));
  updateGenxStaffCount();
}

function addGenxStaffCard(p = {}) {
  const grid = document.getElementById('genxStaffGrid');
  if (!grid) return;

  const activeCerts = (p.certs || []).filter(Boolean);
  const certTagsHtml = activeCerts.map(c => `
    <span class="cert-tag">
      <input type="hidden" value="${esc(c)}">
      ${esc(c)}<button type="button" onclick="this.parentElement.remove();scheduleSave()" title="Remove">×</button>
    </span>`).join('');

  const certAddSelect = `
    <select class="cert-add-select" onchange="addCertTag(this)">
      <option value="">+ Add Cert</option>
      ${CERT_OPTIONS.filter(o => o).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
    </select>`;

  const div = document.createElement('div');
  div.className = 'person-card genx-staff-card';

  const initials = getInitials(p.name || '');
  const photoHtml = p.photo
    ? `<img src="${esc(p.photo)}" alt="">`
    : `<span>${initials || '?'}</span>`;

  div.innerHTML = `
    <button class="person-card-remove" onclick="this.closest('.genx-staff-card').remove();updateGenxStaffCount();scheduleSave()" title="Remove">×</button>
    <div class="person-photo-wrap">
      <div class="person-photo" onclick="event.stopPropagation();openPhotoPicker(this)">
        ${photoHtml}
        <div class="person-photo-overlay">📷</div>
      </div>
    </div>
    <input class="person-name-input" value="${esc(p.name || '')}" placeholder="Full Name" oninput="updateInitials(this);scheduleSave()">
    <select class="person-role-input" style="text-align:center;text-align-last:center;cursor:pointer;" onchange="scheduleSave()">
      ${GENX_ROLE_OPTIONS.map(o => `<option value="${esc(o)}"${p.role === o ? ' selected' : ''}>${o || 'Select Role…'}</option>`).join('')}
    </select>
    <input class="person-role-input" style="color:var(--text-2);font-size:11px;" value="${esc(p.phone || '')}" placeholder="Phone" oninput="scheduleSave()">
    <input class="person-role-input" style="color:var(--text-2);font-size:11px;" value="${esc(p.email || '')}" placeholder="Email" oninput="scheduleSave()">
    <div class="cert-tags-wrap" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;justify-content:center;align-items:center;">
      ${certTagsHtml}
      ${certAddSelect}
    </div>
    <div style="margin-top:8px;text-align:center;font-size:11px;font-weight:700;letter-spacing:1px;color:var(--text-2);text-transform:uppercase;border-top:1px solid var(--border);padding-top:8px;">NOT ARMED</div>`;

  grid.appendChild(div);
  updateGenxStaffCount();
}

function addCertTag(select) {
  const val = select.value;
  if (!val) return;
  const wrap = select.closest('.cert-tags-wrap');
  const tag = document.createElement('span');
  tag.className = 'cert-tag';
  tag.innerHTML = `<input type="hidden" value="${esc(val)}">${esc(val)}<button type="button" onclick="this.parentElement.remove();scheduleSave()" title="Remove">×</button>`;
  wrap.insertBefore(tag, select);
  select.value = '';
  scheduleSave();
}

function updateGenxStaffCount() {
  const grid = document.getElementById('genxStaffGrid');
  const countEl = document.getElementById('genxSecurity');
  if (!grid || !countEl) return;
  const count = grid.querySelectorAll('.genx-staff-card').length;
  countEl.value = count > 0 ? count : '';
}

function collectGenxStaff() {
  const grid = document.getElementById('genxStaffGrid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.genx-staff-card')].map(card => {
    const inputs  = [...card.querySelectorAll('input:not(.photo-input):not([type=hidden])')];
    const selects = [...card.querySelectorAll('select')];
    const img = card.querySelector('.person-photo img');
    return {
      name:  inputs[0]?.value || '',
      role:  selects[0]?.value || '',
      phone: inputs[1]?.value || '',
      email: inputs[2]?.value || '',
      certs: [...card.querySelectorAll('.cert-tag input[type=hidden]')].map(i => i.value).filter(Boolean),
      photo: img?.getAttribute('src') || ''
    };
  });
}

// ── Emergency Contacts ────────────────────────────────────────────────────────

function renderEmergency(rows) {
  const body = document.getElementById('emergencyBody');
  if (!body) return;
  body.innerHTML = '';
  rows.forEach(r => addEmergencyRow(r));
}

function addEmergencyRow(r = {}) {
  const body = document.getElementById('emergencyBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="inline-input" value="${esc(r.role || '')}" placeholder="Role" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(r.name || '')}" placeholder="Name / Organization" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(r.phone || '')}" placeholder="Phone" oninput="scheduleSave()"></td>
    <td><input class="inline-input" value="${esc(r.email || '')}" placeholder="Email" oninput="scheduleSave()"></td>
    <td><button class="btn btn-icon btn-ghost btn-xs" onclick="this.closest('tr').remove();scheduleSave()">×</button></td>`;
  body.appendChild(tr);
}

function collectEmergency() {
  const body = document.getElementById('emergencyBody');
  if (!body) return [];
  return [...body.querySelectorAll('tr')].map(tr => {
    const inputs = tr.querySelectorAll('input');
    return { role: inputs[0]?.value || '', name: inputs[1]?.value || '', phone: inputs[2]?.value || '', email: inputs[3]?.value || '' };
  });
}

// ── Maps ──────────────────────────────────────────────────────────────────────

function renderMaps(maps) {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  maps.forEach(m => addMapZone(m));
}

function addMapZone(m = {}) {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return;
  const div = document.createElement('div');
  div.className = 'map-zone';
  div.innerHTML = `
    <div class="map-zone-header">
      <div>
        <div class="map-zone-title"><input style="background:transparent;border:none;outline:none;color:var(--text);font-weight:700;font-size:12px;font-family:Montserrat,sans-serif;width:100%;" value="${esc(m.title || '')}" placeholder="Map title" oninput="scheduleSave()"></div>
        <div class="map-zone-desc"><input style="background:transparent;border:none;outline:none;color:var(--text-2);font-size:11px;font-family:Montserrat,sans-serif;width:100%;" value="${esc(m.description || '')}" placeholder="Description" oninput="scheduleSave()"></div>
      </div>
      <button class="btn btn-icon btn-ghost btn-xs" onclick="this.closest('.map-zone').remove();scheduleSave()">×</button>
    </div>
    ${m.image ? `<img class="map-preview" src="${esc(m.image)}" alt="">` : ''}
    <label class="map-upload-area${m.image ? ' hidden' : ''}" style="${m.image ? 'display:none;' : ''}">
      <input type="file" accept="image/*" class="map-input" onchange="handleMapUpload(this)">
      <div class="map-upload-icon" style="font-size:28px;margin-bottom:8px;opacity:0.4;">⬆</div>
      <div class="map-upload-text">Drop image or click to upload</div>
    </label>
    ${m.image ? `<div style="padding:8px 12px;border-top:1px solid var(--border);display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm btn-xs" style="font-size:11px;" onclick="openMapEditor(this)" title="Annotate this map with arrows, icons & labels">✏️ Annotate</button>
      <button class="btn btn-ghost btn-sm btn-xs" style="font-size:11px;color:var(--text-3);" onclick="replaceMapImage(this)">↺ Replace</button>
    </div>` : ''}`;
  grid.appendChild(div);
}

function openMapEditor(btn) {
  const zone     = btn.closest('.map-zone');
  const grid     = document.getElementById('mapsGrid');
  const zones    = [...grid.querySelectorAll('.map-zone')];
  const mapIndex = zones.indexOf(zone);
  const img      = zone.querySelector('.map-preview');
  if (!img?.src) return;
  const url = `/map-editor?briefId=${currentBriefId}&mapIndex=${mapIndex}`;
  const win = window.open(url, 'mapEditor', 'width=1200,height=800,resizable=yes');
  // Reload the map image when editor closes
  const timer = setInterval(() => {
    if (win.closed) {
      clearInterval(timer);
      fetch(`${API}/api/briefs/${currentBriefId}`)
        .then(r => r.json())
        .then(b => {
          const maps = b.maps || [];
          if (maps[mapIndex]?.image) img.src = maps[mapIndex].image;
        });
    }
  }, 500);
}

function replaceMapImage(btn) {
  const zone  = btn.closest('.map-zone');
  const input = zone.querySelector('.map-input');
  if (input) input.click();
}

function promptAddMap() {
  const title = prompt('Map title (e.g. "Venue Floor Plan"):');
  if (title !== null) { addMapZone({ title }); scheduleSave(); }
}

function handleMapUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const zone = input.closest('.map-zone');
  const fd = new FormData();
  fd.append('file', file);
  fetch(`${API}/api/upload`, { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.url && zone) {
        const existing = zone.querySelector('.map-preview');
        if (existing) existing.remove();
        const img = document.createElement('img');
        img.className = 'map-preview';
        img.src = data.url;
        zone.querySelector('.map-upload-area').before(img);
        zone.querySelector('.map-upload-area').style.display = 'none';
        scheduleSave();
      }
    })
    .catch(() => toast('Upload failed', 'error'));
}

function collectMaps() {
  const grid = document.getElementById('mapsGrid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.map-zone')].map(zone => {
    const inputs = zone.querySelectorAll('input:not(.map-input)');
    const img = zone.querySelector('.map-preview');
    return { title: inputs[0]?.value || '', description: inputs[1]?.value || '', image: img?.getAttribute('src') || '' };
  });
}

// ── Completion Dots ───────────────────────────────────────────────────────────

function updateDots() {
  const checks = {
    venue:      () => val('venueName'),
    hotel:      () => val('hotelName'),
    timeline:   () => val('showDate'),
    contacts:   () => val('primaryName'),
    ingress:    () => val('gateCount'),
    staffing:   () => val('totalSecurity'),
    medical:    () => val('hospitalName'),
    evacuation: () => val('primaryExit'),
    meetgreet:  () => val('mgTime'),
    comms:      () => val('securityOps'),
    access:     () => collectDoorSystems().length > 0,
    genxstaff:  () => document.querySelectorAll('#genxStaffGrid .genx-staff-card').length > 0,
    loadin:     () => val('dockLocation'),
    ros:        () => document.querySelectorAll('#rosBody tr').length > 0,
    talent:     () => document.querySelectorAll('#talentGrid .person-card').length > 0,
    crew:       () => document.querySelectorAll('#crewGrid .person-card').length > 0,
    emergency:  () => document.querySelectorAll('#emergencyBody tr').length > 0,
    maps:       () => document.querySelectorAll('#mapsGrid .map-zone').length > 0
  };
  Object.entries(checks).forEach(([id, fn]) => {
    const dot = document.getElementById(`dot-${id}`);
    if (dot) dot.className = 'nav-dot' + (fn() ? ' complete' : '');
  });
}

// ── Sidebar Spy ───────────────────────────────────────────────────────────────

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) { const offset = 92; const top = el.getBoundingClientRect().top + window.scrollY - offset; window.scrollTo({ top, behavior: 'smooth' }); }
}

function initSidebarSpy() {
  const sections = document.querySelectorAll('[id^="sec-"]');
  const navItems = document.querySelectorAll('.nav-item[data-target]');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navItems.forEach(n => n.classList.remove('active'));
        const active = document.querySelector(`.nav-item[data-target="${entry.target.id}"]`);
        if (active) active.classList.add('active');
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  sections.forEach(s => obs.observe(s));
}

// ══════════════════════════════════════════════════════════════════════════════
// BRIEF VIEW
// ══════════════════════════════════════════════════════════════════════════════

async function initBriefView(id) {
  try {
    const res = await fetch(`${API}/api/briefs/${id}`);
    if (!res.ok) throw new Error('Not found');
    const brief = await res.json();
    renderBriefView(brief, id);
  } catch (e) {
    const doc = document.getElementById('briefDocument');
    if (doc) doc.innerHTML = '<div style="text-align:center;padding:80px;color:var(--text-2);">Brief not found.</div>';
  }
}

function renderBriefView(b, id) {
  const editBtn = document.getElementById('editBtn');
  if (editBtn) editBtn.href = `/brief?id=${id}`;

  const navTitle = document.getElementById('viewNavTitle');
  if (navTitle) navTitle.textContent = b.venue?.name || 'Security Brief';

  const v  = b.venue       || {};
  const h  = b.hotel       || {};
  const tl = b.timeline    || {};
  const ct = b.contacts    || {};
  const ing= b.ingress     || {};
  const st = b.staffing    || {};
  const med= b.medical     || {};
  const ev = b.evacuation  || {};
  const mg = b.meetgreet   || {};
  const co = b.communications || {};
  const ac = b.access      || {};
  const li = b.loadinout   || {};

  const doc = document.getElementById('briefDocument');
  if (!doc) return;

  doc.innerHTML = `
    <!-- Header -->
    <div class="brief-header-block">
      <div class="brief-header-red"></div>
      <div class="brief-header-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--red);margin-bottom:8px;">Security Brief — Confidential</div>
            <div class="brief-header-venue">${esc(v.name || 'Security Brief')}</div>
            <div class="brief-header-meta">
              ${tl.showDateTBD ? `<span class="tag tag-red">TBD</span>` : (tl.showDate ? `<span class="tag tag-red">${esc(formatDate(tl.showDate))}</span>` : '')}
              ${v.city || v.state ? `<span class="tag tag-gray">${esc([v.city, v.state].filter(Boolean).join(', '))}</span>` : ''}
              ${tl.showTimeTBD ? `<span class="tag tag-gold">Show: TBD</span>` : (tl.showTime ? `<span class="tag tag-gold">Show: ${esc(formatTime(tl.showTime))}</span>` : '')}
              ${mg.scheduled && mg.totalVips ? `<span class="tag tag-gold">${esc(mg.totalVips)} VIPs</span>` : ''}
            </div>
          </div>
          <div class="brief-header-logo">
            <img src="/genx-logo.png" alt="GenX Corporate Security" style="width:160px;height:160px;object-fit:contain;">
          </div>
        </div>
      </div>
    </div>

    <!-- Venue + Hotel -->
    <div class="grid-2" style="margin-bottom:20px;">
      ${viewPanel('🏛️', 'Venue', `
        <div class="view-kv">
          ${kv('Name',     v.name)}
          ${kv('Address',  [v.street, v.city, v.state, v.zip].filter(Boolean).join(', '))}
          ${kv('Phone',    v.phone)}
          ${kv('Capacity',       v.capacity)}
          ${kv('Total Ticketed', v.totalTicketed)}
          ${kv('Type',           v.type)}
        </div>`)}
      ${viewPanel('🏨', 'Hotel', `
        <div class="view-kv">
          ${kv('Name',      h.name)}
          ${kv('Address',   [h.street, h.city, h.state, h.zip].filter(Boolean).join(', '))}
          ${kv('Phone',     h.phone)}
          ${kv('Check-In',  h.checkin ? formatDate(h.checkin) + (h.checkinTime ? ' ' + formatTime(h.checkinTime) : '') : '')}
          ${kv('Check-Out', h.checkout ? formatDate(h.checkout) + (h.checkoutTime ? ' ' + formatTime(h.checkoutTime) : '') : '')}
        </div>`)}
    </div>

    <!-- Timeline -->
    ${viewPanel('📅', 'Event Timeline', `
      <div class="grid-4" style="margin-bottom:16px;">
        ${miniStat('Arrival',   tl.arrivalDateTBD   ? 'TBD' : (tl.arrivalDate   ? formatDate(tl.arrivalDate)   : '—'), tl.arrivalTimeTBD   ? 'TBD' : (tl.arrivalTime   ? formatTime(tl.arrivalTime)   : ''))}
        ${miniStat('Show Day',  tl.showDateTBD      ? 'TBD' : (tl.showDate      ? formatDate(tl.showDate)      : '—'), tl.showTimeTBD      ? 'TBD' : (tl.showTime      ? 'Show ' + formatTime(tl.showTime)      : ''))}
        ${miniStat('Doors',     tl.doorsTimeTBD     ? 'TBD' : (tl.doorsTime     ? formatTime(tl.doorsTime)     : '—'), '')}
        ${miniStat('Departure', tl.departureDateTBD ? 'TBD' : (tl.departureDate ? formatDate(tl.departureDate) : '—'), tl.departureTimeTBD ? 'TBD' : (tl.departureTime ? formatTime(tl.departureTime) : ''))}
      </div>
      ${tl.notes ? `<div style="font-size:13px;color:var(--text-2);padding:12px;background:var(--surface-2);border-radius:8px;">${esc(tl.notes)}</div>` : ''}`)}

    <!-- Security Contacts -->
    ${viewPanel('🛡️', 'Security Contacts', `
      <div class="contact-cards-grid" style="pointer-events:none;">
        <div class="contact-card primary">
          <div class="contact-card-badge">Primary</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${esc(ct.primary?.name || '—')}</div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:12px;">${esc(ct.primary?.title || '')}</div>
          <div class="view-kv">
            ${kv('Phone', ct.primary?.phone)}
            ${kv('Cell',  ct.primary?.cell)}
            ${kv('Email', ct.primary?.email)}
          </div>
        </div>
        <div class="contact-card backup">
          <div class="contact-card-badge">Backup</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${esc(ct.backup?.name || '—')}</div>
          <div style="font-size:12px;color:var(--text-2);margin-bottom:12px;">${esc(ct.backup?.title || '')}</div>
          <div class="view-kv">
            ${kv('Phone', ct.backup?.phone)}
            ${kv('Cell',  ct.backup?.cell)}
            ${kv('Email', ct.backup?.email)}
          </div>
        </div>
      </div>`)}

    <!-- Ingress & Staffing -->
    <div class="grid-2" style="margin-bottom:20px;">
      ${viewPanel('🚪', 'Ingress & Screening', `
        <div class="view-kv">
          ${kv('Methods', [ing.magnetometer && 'Magnetometer', ing.bagCheck && 'Bag Check', ing.wand && 'Wand', ing.patDown && 'Pat Down', ing.visualInspection && 'Visual Inspection', ing.evolv && 'Evolv'].filter(Boolean).join(', '))}
          ${kv('Ticketing', ing.ticketingType)}
          ${kv('Entry Points', ing.gateCount)}
          ${kv('Gate Open', ing.gateOpenTime ? formatTime(ing.gateOpenTime) : '')}
        </div>
        ${ing.prohibitedItems?.length ? `<div style="margin-top:12px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Prohibited Items</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${ing.prohibitedItems.map(t => `<span class="tag tag-red">${esc(t)}</span>`).join('')}</div></div>` : ''}
        ${ing.notes ? `<div style="margin-top:12px;font-size:12px;color:var(--text-2);">${esc(ing.notes)}</div>` : ''}`)}
      ${viewPanel('👮', 'Staffing', `
        <div class="grid-3" style="gap:8px;margin-bottom:12px;">
          ${miniStat('Security', st.totalSecurity || '—', '')}
          ${miniStat('Ushers', st.ushers || '—', '')}
          ${miniStat('LEO', st.leo || '—', '')}
          ${miniStat('Backstage', st.backstageSecurity || '—', '')}
          ${st.genxSecurity ? miniStat('GenX Security', st.genxSecurity, '') : ''}
        </div>
        ${st.uniformed && st.uniformDesc ? `<div style="font-size:12px;color:var(--text-2);padding:10px;background:var(--surface-2);border-radius:8px;">${esc(st.uniformDesc)}</div>` : ''}
        ${st.notes ? `<div style="margin-top:8px;font-size:12px;color:var(--text-2);">${esc(st.notes)}</div>` : ''}`)}
    </div>

    <!-- Medical & Evacuation -->
    <div class="grid-2" style="margin-bottom:20px;">
      ${viewPanel('⚕️', 'Medical & Emergency', `
        <div class="view-kv">
          ${kv('Trained Medical Staff', med.onSite ? 'Yes' : 'No')}
          ${kv('Medical Personnel', med.firstResponderCount)}
          ${kv('AED On Site', med.aedOnSite ? 'Yes' : 'No')}
          ${kv('AED Near Stage', med.aedNearStage ? 'Yes' : 'No')}
          ${kv('First Aid', med.firstAidLocations)}
          ${kv('Hospital', med.hospitalName)}
          ${kv('Hosp. Phone', med.hospitalPhone)}
        </div>
        ${med.emergencyProtocol ? `<div style="margin-top:12px;font-size:12px;color:var(--text-2);padding:10px;background:var(--surface-2);border-radius:8px;">${esc(med.emergencyProtocol)}</div>` : ''}`)}
      ${viewPanel('🚨', 'Evacuation', `
        <div class="view-kv">
          ${kv('Primary Exit',   ev.primaryExit)}
          ${kv('Secondary Exit', ev.secondaryExit)}
          ${kv('Rally Point',    ev.rallyPoint)}
          ${kv('Evacuation Announcement', med.announcementMethod)}
        </div>
        ${ev.safeRooms?.length ? `<div style="margin-top:10px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:5px;">Safe Rooms</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${ev.safeRooms.map(r => `<span class="tag tag-blue">${esc(r)}</span>`).join('')}</div></div>` : ''}
        ${ev.eapNotes ? `<div style="margin-top:10px;font-size:12px;color:var(--text-2);padding:10px;background:var(--surface-2);border-radius:8px;">${esc(ev.eapNotes)}</div>` : ''}
        ${ev.lockdownProtocol ? `<div style="margin-top:8px;font-size:12px;color:var(--red);padding:10px;background:var(--red-dim);border-radius:8px;border:1px solid rgba(230,57,70,0.2);">${esc(ev.lockdownProtocol)}</div>` : ''}`)}
    </div>

    <!-- Meet & Greet + Communications -->
    <div class="grid-2" style="margin-bottom:20px;">
      ${viewPanel('🤝', 'Meet & Greet', `
        ${mg.scheduled ? `
        ${mg.totalVips ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:12px 16px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border);">
          <div style="font-size:28px;font-weight:800;color:var(--gold);line-height:1;">${esc(mg.totalVips)}</div>
          <div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-3);">Total VIPs</div><div style="font-size:11px;color:var(--text-2);">Meet &amp; Greet</div></div>
        </div>` : ''}
        <div class="view-kv">
          ${kv('Time',         mg.time ? formatTime(mg.time) : '')}
          ${kv('Duration',     mg.duration ? mg.duration + ' min' : '')}
          ${kv('Location',     mg.location)}
          ${kv('Security Staff', mg.staffAssigned)}
          ${kv('GenX Staff', mg.genxStaff)}
        </div>
        ${mg.protocol ? `<div style="margin-top:10px;font-size:12px;color:var(--text-2);padding:10px;background:var(--surface-2);border-radius:8px;">${esc(mg.protocol)}</div>` : ''}` :
        '<div style="color:var(--text-3);font-size:13px;">No Meet &amp; Greet scheduled.</div>'}`)}
      ${viewPanel('📻', 'Communications', `
        <div class="view-kv">
          ${kv('Venue Shares Comms', co.venueShareComms ? 'Yes' : 'No')}
          ${kv('Security Operations', co.securityOps)}
          ${kv('Sec Ops Phone', co.securityOpsPhone)}
          ${kv('Cell OK', co.cellOk ? 'Yes' : 'No')}
        </div>
        ${(co.channels || []).length ? `<div style="margin-top:12px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Radio Channels</div><div class="channel-grid">${co.channels.map(ch => `<div class="channel-row"><div class="channel-num" style="font-weight:800;">${esc(ch.ch)}</div><div class="channel-use">${esc(ch.use)}</div></div>`).join('')}</div></div>` : ''}`)}
    </div>

    <!-- Access Control -->
    ${viewPanel('🔑', 'Access Control', `
      ${(ac.doorSystems || []).length ? `<div style="margin-bottom:12px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Venue Access Control Devices</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${(ac.doorSystems || []).map(s => `<span class="tag tag-gray">${esc(s)}</span>`).join('')}</div></div>` : ''}
      ${(ac.credentials || []).length ? `
        <div style="overflow-x:auto;margin-top:4px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Additional Venue-Required Credentials</div>
          <table class="data-table">
            <thead><tr><th>Credential</th><th>Color</th><th>Access Level</th><th>Location</th><th>Image</th></tr></thead>
            <tbody>
              ${(ac.credentials || []).map(c => `<tr><td style="font-weight:600;">${esc(c.name)}</td><td><span class="tag tag-gray">${esc(c.color)}</span></td><td style="color:var(--text-2);">${esc(c.level)}</td><td style="color:var(--text-2);">${esc(c.location || '')}</td><td>${c.image ? `<img src="${esc(c.image)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">` : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
      ${ac.genxCred && (ac.genxCred.frontImage || ac.genxCred.backImage || ac.genxCred.name) ? `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:12px;">GenX Security Credentials</div>
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;">
            ${ac.genxCred.name ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">${esc(ac.genxCred.name)}</div>` : ''}
            ${ac.genxCred.issuedBy ? `<div style="font-size:11px;color:var(--text-3);margin-bottom:12px;">Issued by: ${esc(ac.genxCred.issuedBy)}</div>` : ''}
            <div style="display:flex;gap:16px;flex-wrap:wrap;">
              ${ac.genxCred.frontImage ? `<div style="flex:1;min-width:120px;max-width:200px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Front</div><img src="${esc(ac.genxCred.frontImage)}" style="width:100%;border-radius:8px;aspect-ratio:0.63;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>` : ''}
              ${ac.genxCred.backImage  ? `<div style="flex:1;min-width:120px;max-width:200px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Back</div><img src="${esc(ac.genxCred.backImage)}" style="width:100%;border-radius:8px;aspect-ratio:0.63;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>` : ''}
            </div>
            ${ac.genxCred.notes ? `<div style="margin-top:10px;font-size:12px;color:var(--text-2);">${esc(ac.genxCred.notes)}</div>` : ''}
          </div>
        </div>` : ''}
      ${ac.parkingNotes ? `<div style="margin-top:12px;font-size:12px;color:var(--text-2);">${esc(ac.parkingNotes)}</div>` : ''}`)}

    <!-- Load In/Out -->
    ${viewPanel('🚚', 'Load In / Load Out', `
      <div class="grid-2">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Load In</div>
          <div class="view-kv">
            ${kv('Date', li.loadinDate ? formatDate(li.loadinDate) : '')}
            ${kv('Time', li.loadinTime ? formatTime(li.loadinTime) : '')}
            ${kv('Dock', li.dockLocation)}
          </div>
          ${li.loadinNotes ? `<div style="margin-top:8px;font-size:12px;color:var(--text-2);">${esc(li.loadinNotes)}</div>` : ''}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Load Out</div>
          <div class="view-kv">
            ${kv('Date', li.loadoutDate ? formatDate(li.loadoutDate) : '')}
            ${kv('Time', li.loadoutTime ? formatTime(li.loadoutTime) : '')}
            ${kv('Vehicles', li.vehicleCount)}
          </div>
          ${li.loadoutNotes ? `<div style="margin-top:8px;font-size:12px;color:var(--text-2);">${esc(li.loadoutNotes)}</div>` : ''}
        </div>
      </div>`)}

    <!-- Run of Show -->
    ${(b.runofshow || []).length ? viewPanel('📋', 'Run of Show', `
      <div style="overflow-x:auto;">
        <table class="ros-table">
          <thead><tr><th>Time</th><th>Activity</th><th>Security Notes</th><th style="width:70px;">Critical</th></tr></thead>
          <tbody>
            ${(b.runofshow || []).map(r => `
              <tr class="${r.critical ? 'ros-row-critical' : ''}">
                <td style="font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap;">${esc(r.time ? formatTime(r.time) : r.time)}</td>
                <td style="font-weight:${r.critical ? '700' : '500'};">${esc(r.activity)}</td>
                <td style="color:var(--text-2);">${esc(r.notes)}</td>
                <td style="text-align:center;">${r.critical ? '<span class="tag tag-red" style="font-size:9px;">CRITICAL</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`) : ''}

    <!-- Talent -->
    ${(b.talent || []).length ? viewPanel('🎤', 'Talent', `
      <div class="person-grid">
        ${(b.talent || []).map(p => `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            ${p.stageName ? `<div class="person-stage">${esc(p.stageName)}</div>` : ''}
            <div class="person-role">${esc(p.role)}</div>
            ${p.notes ? `<div class="person-notes" style="margin-top:8px;">${esc(p.notes)}</div>` : ''}
          </div>`).join('')}
      </div>`) : ''}

    <!-- Crew -->
    ${(b.crew || []).length ? viewPanel('🎬', 'Crew & Production', `
      <div class="person-grid">
        ${(b.crew || []).map(p => `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            <div class="person-role">${esc(p.function)}</div>
            ${p.phone ? `<div class="person-stage" style="font-style:normal;">${esc(p.phone)}</div>` : ''}
            ${p.notes ? `<div class="person-notes" style="margin-top:8px;">${esc(p.notes)}</div>` : ''}
          </div>`).join('')}
      </div>`) : ''}

    <!-- GenX Security Staff -->
    ${(b.genxstaff || []).length ? viewPanel('🛡️', 'GenX Security Staff', `
      <div class="person-grid">
        ${(b.genxstaff || []).map(p => `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            <div class="person-role">${esc(p.role)}</div>
            ${p.phone ? `<div class="person-stage" style="font-style:normal;">${esc(p.phone)}</div>` : ''}
            ${p.email ? `<div class="person-stage" style="font-style:normal;font-size:11px;">${esc(p.email)}</div>` : ''}
            ${(p.certs || []).filter(Boolean).length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px;">${(p.certs || []).filter(Boolean).map(c => `<span class="tag tag-red" style="font-size:9px;">${esc(c)}</span>`).join('')}</div>` : ''}
          </div>`).join('')}
      </div>`) : ''}

    <!-- Emergency Contacts -->
    ${(b.emergency || []).length ? viewPanel('🆘', 'Emergency Contacts', `
      <table class="data-table">
        <thead><tr><th>Role</th><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
        <tbody>
          ${(b.emergency || []).map(e => `
            <tr>
              <td style="font-weight:600;color:var(--text);">${esc(e.role)}</td>
              <td>${esc(e.name)}</td>
              <td style="font-variant-numeric:tabular-nums;">${esc(e.phone)}</td>
              <td style="color:var(--text-3);">${esc(e.email)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`) : ''}

    <!-- Maps -->
    ${(b.maps || []).some(m => m.image) ? viewPanel('🗺️', 'Venue Maps & Diagrams', `
      <div style="display:flex;flex-direction:column;gap:24px;">
        ${(b.maps || []).filter(m => m.image).map(m => `
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
            <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
              <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(m.title)}</div>
              ${m.description ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(m.description)}</div>` : ''}
            </div>
            <img src="${esc(m.image)}" alt="${esc(m.title)}" style="display:block;width:100%;height:auto;object-fit:contain;max-height:600px;background:#000;">
          </div>`).join('')}
      </div>`) : ''}

    <div style="text-align:center;padding:32px 0 16px;color:var(--text-3);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
      — GenX Security Brief System — Confidential Document —
    </div>
  `;
}

// ── View helpers ──────────────────────────────────────────────────────────────

function viewPanel(icon, title, content) {
  return `
    <div class="view-panel">
      <div class="view-panel-header">
        <span style="font-size:16px;">${icon}</span>
        <h3>${esc(title)}</h3>
      </div>
      <div class="view-panel-body">${content}</div>
    </div>`;
}

function kv(key, value) {
  if (!value) return '';
  return `<div class="view-key">${esc(key)}</div><div class="view-val">${esc(String(value))}</div>`;
}

function miniStat(label, value, sub) {
  return `
    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;">${esc(String(value))}</div>
      <div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">${esc(label)}</div>
      ${sub ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(sub)}</div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (path === '/' || path === '/index.html') {
    initDashboard();
  }
  // brief and view pages call their init from inline script
});
