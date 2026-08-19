'use strict';

// ── Config & State ────────────────────────────────────────────────────────────
const API = '';
let currentBriefId = null;
let saveTimer = null;
let briefLoaded = false;
let _saveInFlight = false;
let _savePending = false;
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
  // Only convert bare 24h clock times — free text ("2:30 PM", "1 hr prior", "TBD") passes through
  if (!/^\d{1,2}:\d{2}$/.test(String(ts).trim())) return ts;
  const [h, m] = String(ts).trim().split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

// True if the show date is before today (any time today still counts as upcoming).
function isPastShow(ds) {
  if (!ds) return false;
  try {
    const d = new Date(ds.includes('T') ? ds : ds + 'T23:59:59');
    return d.getTime() < Date.now();
  } catch (_) { return false; }
}

// Whole days from today until the show date. 0 = today, negative = past, null = unknown.
function daysUntilShow(ds) {
  if (!ds) return null;
  try {
    const show = new Date(ds.includes('T') ? ds : ds + 'T12:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const showMidnight = new Date(show); showMidnight.setHours(0, 0, 0, 0);
    return Math.round((showMidnight.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  } catch (_) { return null; }
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
  if (el.type === 'date' || el.type === 'time') el.classList.toggle('is-empty', !el.value);
}

function syncDateTimeEmptyClasses() {
  document.querySelectorAll('input[type="date"], input[type="time"]').forEach(inp => {
    inp.classList.toggle('is-empty', !inp.value);
  });
}

// Keep is-empty class fresh whenever the user edits a date/time anywhere
function _maybeToggleEmpty(t) {
  if (t && (t.type === 'date' || t.type === 'time')) {
    t.classList.toggle('is-empty', !t.value);
  }
}
document.addEventListener('input',  (e) => _maybeToggleEmpty(e.target), true);
document.addEventListener('change', (e) => _maybeToggleEmpty(e.target), true);
document.addEventListener('blur',   (e) => _maybeToggleEmpty(e.target), true);
document.addEventListener('DOMContentLoaded', () => {
  if (typeof syncDateTimeEmptyClasses === 'function') syncDateTimeEmptyClasses();
});

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

  // Sort: upcoming shows first (soonest first), then past shows (most recent first).
  // Briefs without a show date sink to the bottom of their group.
  briefs = briefs.slice().sort((a, b) => {
    const aPast = isPastShow(a.showDate);
    const bPast = isPastShow(b.showDate);
    if (aPast !== bPast) return aPast ? 1 : -1;       // upcoming before past
    if (!a.showDate && !b.showDate) return 0;
    if (!a.showDate) return 1;
    if (!b.showDate) return -1;
    return aPast
      ? b.showDate.localeCompare(a.showDate)           // past: newest first
      : a.showDate.localeCompare(b.showDate);          // upcoming: soonest first
  });

  briefs.forEach((b, i) => {
    const past = isPastShow(b.showDate);
    const days = daysUntilShow(b.showDate);
    const card = document.createElement('div');
    card.className = `brief-card fade-in-up stagger-${Math.min(i + 1, 5)}${past ? ' brief-card-past' : ''}`;
    if (past) card.style.opacity = '0.78';
    const dateColor = past ? 'var(--green, #3fb950)' : 'var(--red)';

    // Status badge: green "Show Complete" if past, otherwise countdown coloured by urgency.
    let statusBadge = '';
    if (past) {
      statusBadge = `<span style="display:inline-flex;align-items:center;gap:4px;align-self:flex-start;padding:2px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#3fb950;background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.3);border-radius:4px;">✓ Show Complete</span>`;
    } else if (days !== null) {
      let label, color;
      if (days === 0)      { label = '🔴 Show Day';        color = '#e63946'; }
      else if (days === 1) { label = '⚡ 1 Day to Go';      color = '#f4845f'; }
      else if (days <= 7)  { label = `⚡ ${days} Days to Go`; color = '#f4845f'; }
      else if (days <= 30) { label = `${days} Days to Go`;   color = '#58a6ff'; }
      else                 { label = `${days} Days to Go`;   color = '#8b949e'; }
      statusBadge = `<span style="display:inline-flex;align-items:center;gap:4px;align-self:flex-start;padding:2px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${color};background:${color}1f;border:1px solid ${color}55;border-radius:4px;">${label}</span>`;
    }

    // Published pill — at-a-glance signal that Talent/Crew can see this brief.
    const publishedPill = b.status === 'finalized'
      ? `<span title="Visible to Talent/Crew" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);border-radius:4px;">✓ Published</span>`
      : `<span title="Draft — Talent/Crew cannot see this yet" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;">Draft</span>`;

    card.innerHTML = `
      <div class="brief-card-top"></div>
      <div class="brief-card-body" onclick="window.location='/brief?id=${esc(b.id)}'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0;">
            <div class="brief-card-venue" style="margin-bottom:0;">${esc(b.venueName || 'Untitled Brief')}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${statusBadge}
              ${publishedPill}
            </div>
          </div>
          ${b.showDate ? `<div style="text-align:right;flex-shrink:0;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);">Venue Date</div><div style="font-size:12px;font-weight:700;color:${dateColor};">${esc(formatDate(b.showDate))}</div></div>` : ''}
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
  const printBtn = `<button onclick="event.stopPropagation();printBlankIntake('${esc(b.venueName || '')}','${esc(b.showDate || '')}','${esc(b.id || '')}')" title="Open a printable questionnaire pre-filled with this brief's data (use as email backup)" style="font-size:11px;font-weight:700;color:var(--text-3);background:none;border:1px solid var(--border);border-radius:5px;padding:3px 8px;cursor:pointer;font-family:inherit;" onmouseover="this.style.color='var(--text)';this.style.borderColor='var(--border-2)'" onmouseout="this.style.color='var(--text-3)';this.style.borderColor='var(--border)'">🖨 Print</button>`;
  if (!b.intakeStatus) {
    return `<div style="padding:8px 20px 12px;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Venue Intake</span>
        <span style="font-size:11px;color:var(--text-3);">— Not started</span>
        <div style="display:flex;gap:6px;margin-left:auto;">
          ${printBtn}
          <a href="/brief?id=${esc(b.id)}" onclick="event.stopPropagation();" style="font-size:11px;font-weight:700;color:var(--text-3);text-decoration:none;padding:3px 8px;border:1px solid var(--border);border-radius:5px;" onmouseover="this.style.color='var(--text)';this.style.borderColor='var(--border-2)'" onmouseout="this.style.color='var(--text-3)';this.style.borderColor='var(--border)'">Open →</a>
        </div>
      </div>
    </div>`;
  }
  if (b.intakeStatus === 'pending') {
    const sent = b.intakeSentAt ? new Date(b.intakeSentAt).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
    return `<div style="padding:8px 20px 12px;border-top:1px solid rgba(210,153,34,0.25);background:rgba(210,153,34,0.04);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;color:#d29922;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">⏳ Awaiting Venue</span>
        <span style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="${esc(b.intakeEmail || '')}">${esc(b.intakeEmail || '')}</span>
        ${sent ? `<span style="font-size:10px;color:var(--text-3);">Sent ${sent}</span>` : ''}
        <div style="display:flex;gap:6px;margin-left:auto;">
          <button onclick="event.stopPropagation();cancelIntake('${esc(b.id)}')" style="font-size:10px;font-weight:700;color:var(--red);background:none;border:1px solid rgba(230,57,70,0.3);border-radius:5px;padding:2px 8px;cursor:pointer;font-family:inherit;">Cancel</button>
        </div>
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

function printBlankIntake(venueName, showDate, briefId) {
  const params = new URLSearchParams();
  if (briefId)   params.set('briefId', briefId);
  if (venueName) params.set('venue', venueName);
  if (showDate)  params.set('date',  showDate);
  const qs = params.toString();
  window.open('/intake-blank.html' + (qs ? '?' + qs : ''), '_blank', 'noopener');
}

async function resendIntake(briefId) {
  try {
    const r = await fetch(`${API}/api/briefs/${briefId}/intake/resend`, { method: 'POST' });
    let d = {};
    try { d = await r.json(); } catch (_) {}
    if (!r.ok) { toast(d.error || `Server error ${r.status}`, 'error'); return; }
    toast('Questionnaire resent', 'success');
    const res = await fetch(`${API}/api/briefs`);
    allBriefs = await res.json();
    renderDashboard(allBriefs);
  } catch (e) { toast('Network error — is the server running?', 'error'); }
}

async function cancelIntake(briefId) {
  if (!confirm('Cancel this venue questionnaire? The link will stop working.')) return;
  try {
    const r = await fetch(`${API}/api/briefs/${briefId}/intake`, { method: 'DELETE' });
    let d = {};
    try { d = await r.json(); } catch (_) {}
    if (!r.ok) { toast(d.error || `Server error ${r.status}`, 'error'); return; }
    toast('Questionnaire cancelled', 'success');
    const res = await fetch(`${API}/api/briefs`);
    allBriefs = await res.json();
    renderDashboard(allBriefs);
  } catch (e) { toast('Network error — is the server running?', 'error'); }
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
  briefLoaded = false;
  let ok = true;
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
      ok = false;
      toast('Failed to load brief', 'error');
    }
  } else {
    initBlankROSAndPeople();
  }
  initSidebarSpy();
  if (ok) briefLoaded = true;
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
  setVal('hotelCheckout',    b.hotel?.checkout);

  // Timeline
  setVal('arrivalDate',   b.timeline?.arrivalDate);
  setVal('mediaDate',     b.timeline?.mediaDate);
  setVal('mediaTime',     b.timeline?.mediaTime);
  setVal('showDate',      b.timeline?.showDate);
  setVal('doorsTime',     b.timeline?.doorsTime);
  setVal('showTime',      b.timeline?.showTime);
  setVal('departureDate', b.timeline?.departureDate);
  setVal('timelineNotes', b.timeline?.notes);
  // Restore TBD states
  applyTBDState('arrivalDate',   b.timeline?.arrivalDateTBD);
  applyTBDState('showDate',      b.timeline?.showDateTBD);
  applyTBDState('doorsTime',     b.timeline?.doorsTimeTBD);
  applyTBDState('showTime',      b.timeline?.showTimeTBD);
  applyTBDState('departureDate', b.timeline?.departureDateTBD);
  renderTimeline();

  setVal('venuePriorIncidents', b.venue?.priorIncidents);
  const md = b.mediaDay || {};
  setVal('mediaScheduled',   md.scheduled === true || md.scheduled === 'yes');
  setVal('mediaTimeWindow',  md.timeWindow);
  setVal('mediaDayLocation', md.location);
  setVal('mediaEscort',      md.escort);
  setVal('mediaDayNotes',    md.notes);
  toggleMediaDayFields(false);

  setVal('venueBusinessName', b.venue?.businessName);

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
  setVal('leOnSite',     b.contacts?.leOnSite);
  setVal('leAgency',     b.contacts?.leAgency);

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

  const cr = b.crowd || {};
  setVal('crowdNeeded',         cr.needed);
  setVal('crowdAudience',       cr.audience);
  setVal('crowdBarricadeType',  cr.barricadeType);
  setVal('crowdStageBarricade', cr.stageBarricade);
  setVal('crowdNotes',          cr.notes);
  toggleCrowdFields(false);

  // Staffing
  const st = b.staffing || {};
  setVal('totalSecurity',    st.totalSecurity);
  setVal('leoCount',         st.leo);
  setVal('backstageSecurity',st.backstageSecurity);
  enforceBackstageCap();
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
  setVal('announcementMethod',   med.announcementMethod);
  setVal('medicalToGreenRoom',   med.toGreenRoom);

  // Evacuation
  const evac = b.evacuation || {};
  setVal('primaryExit',      evac.primaryExit);
  setVal('secondaryExit',    evac.secondaryExit);
  setVal('rallyPoint',       evac.rallyPoint);
  setVal('eapNotes',         evac.eapNotes);
  setVal('lockdownProtocol', evac.lockdownProtocol);
  if (evac.safeRooms?.length) document.getElementById('safeRoomInput').value = Array.isArray(evac.safeRooms) ? evac.safeRooms.join('\n') : evac.safeRooms;

  setVal('weatherPlan', evac.weatherPlan);
  if (evac.weatherPlan && String(evac.weatherPlan).trim()) showWeatherPlan();

  // Meet & Greet — protocol & gift policy are permanent canned text (read from hidden inputs in brief.html)
  const mg = b.meetgreet || {};
  setVal('mgGenxStaff', mg.genxStaff);

  // Communications
  const comms = b.communications || {};
  setVal('venueShareComms', comms.venueShareComms);
  setVal('securityOps',     comms.securityOps);
  setVal('securityOpsPhone',comms.securityOpsPhone);
  setVal('cellOk',          comms.cellOk);
  setVal('commsNotes',      comms.notes);
  setVal('opsCenterOnSite', comms.opsCenterOnSite);
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
  const cc = b.cctv || {};
  setVal('cctvCoverage',  cc.coverage);
  setVal('cctvMonitored', cc.monitored);
  setVal('cctvNotes',     cc.notes);
  setVal('backstageControlled', acc.backstageControlled);
  setVal('castCrewAccess',      acc.castCrewAccess);
  setVal('teamArrival',         acc.teamArrival);
  setVal('accessAddlCreds',     acc.additionalCredentials);

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
  const noMapsCb = document.getElementById('noMapsProvided');
  if (noMapsCb) noMapsCb.checked = !!b.noMapsProvided;
  toggleNoMaps(false);

  // Defensive: re-sync every TBD-pair so an input is only disabled if its
  // checkbox is actually checked. Catches any stale .tbd-active state.
  ['arrivalDate','showDate','doorsTime','showTime','departureDate'].forEach(id => {
    const inp = document.getElementById(id);
    const cb  = document.getElementById(id + 'TBD');
    if (!inp) return;
    const tbd = !!(cb && cb.checked);
    inp.classList.toggle('tbd-active', tbd);
    inp.disabled = tbd;
  });
  // Hotel date fields have no TBD — guarantee they're editable
  ['hotelCheckin','hotelCheckout'].forEach(id => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.classList.remove('tbd-active');
    inp.disabled = false;
  });

  // Status bar
  updateStatusBar(b.venue?.name);

  // Refresh empty-state class on every date/time input so blue placeholders disappear
  syncDateTimeEmptyClasses();

  // Reflect whether the hotel address already mirrors the venue
  syncSameAsVenueToggle();

  // Light up the green section-ready dots based on what's already filled in
  updateDots();
}

// Collapse toggles for optional brief subsections (media day, crowd, weather)
function toggleMediaDayFields(save = true) {
  const on = !!document.getElementById('mediaScheduled')?.checked;
  const wrap = document.getElementById('mediaDayFields');
  if (wrap) wrap.style.display = on ? '' : 'none';
  if (save) scheduleSave();
}
function toggleCrowdFields(save = true) {
  const sel = document.getElementById('crowdNeeded');
  const wrap = document.getElementById('crowdFields');
  if (wrap) wrap.style.display = (sel?.value === 'yes') ? '' : 'none';
  if (save) scheduleSave();
}
function showWeatherPlan(focus = false) {
  const wrap = document.getElementById('weatherWrap');
  const link = document.getElementById('weatherAddLink');
  if (wrap) wrap.style.display = '';
  if (link) link.style.display = 'none';
  if (focus) document.getElementById('weatherPlan')?.focus();
}

function initBlankROSAndPeople() {
  toggleNoMaps(false);
  renderROSTable([]);
  renderPersonGrid([], 'talentGrid', 'talent');
  renderPersonGrid([], 'crewGrid', 'crew');
  renderGenxStaffGrid([]);
  renderEmergency([]);
  renderMaps([]);
  renderChannels([]);
  renderCredentials([]);
  renderGenxCredentials([]);
  syncDateTimeEmptyClasses();
}

// ── Collect all form data ─────────────────────────────────────────────────────

function collectBrief() {
  return {
    venue: {
      name:     val('venueName'),
      businessName: val('venueBusinessName'),
      street:   val('venueStreet'),
      city:     val('venueCity'),
      state:    val('venueState'),
      zip:      val('venueZip'),
      phone:    val('venuePhone'),
      capacity: val('venueCapacity'),
      type:         val('venueType'),
      contactEmail: val('venueContactEmail'),
      priorIncidents: val('venuePriorIncidents')
    },
    hotel: {
      name:        val('hotelName'),
      street:      val('hotelStreet'),
      city:        val('hotelCity'),
      state:       val('hotelState'),
      zip:         val('hotelZip'),
      phone:       val('hotelPhone'),
      checkin:     val('hotelCheckin'),
      checkout:    val('hotelCheckout')
    },
    timeline: {
      arrivalDate:      val('arrivalDate'),
      arrivalDateTBD:   val('arrivalDateTBD'),
      mediaDate:        val('mediaDate'),
      mediaTime:        val('mediaTime'),
      showDate:         val('showDate'),
      showDateTBD:      val('showDateTBD'),
      doorsTime:        val('doorsTime'),
      doorsTimeTBD:     val('doorsTimeTBD'),
      showTime:         val('showTime'),
      showTimeTBD:      val('showTimeTBD'),
      departureDate:    val('departureDate'),
      departureDateTBD: val('departureDateTBD'),
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
      },
      leOnSite: val('leOnSite'),
      leAgency: val('leAgency')
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
    crowd: {
      needed:         val('crowdNeeded'),
      audience:       val('crowdAudience'),
      barricadeType:  val('crowdBarricadeType'),
      stageBarricade: val('crowdStageBarricade'),
      notes:          val('crowdNotes')
    },
    cctv: {
      coverage:  val('cctvCoverage'),
      monitored: val('cctvMonitored'),
      notes:     val('cctvNotes')
    },
    staffing: {
      totalSecurity:    val('totalSecurity'),
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
      announcementMethod:  val('announcementMethod'),
      toGreenRoom:         val('medicalToGreenRoom')
    },
    evacuation: {
      primaryExit:      val('primaryExit'),
      secondaryExit:    val('secondaryExit'),
      safeRooms:        (document.getElementById('safeRoomInput')?.value || '').split('\n').map(s => s.trim()).filter(Boolean),
      rallyPoint:       val('rallyPoint'),
      eapNotes:         val('eapNotes'),
      lockdownProtocol: val('lockdownProtocol'),
      weatherPlan:      val('weatherPlan')
    },
    meetgreet: {
      scheduled:    true,
      genxStaff:    val('mgGenxStaff'),
      protocol:     val('mgProtocol'),
      giftPolicy:   val('giftPolicy')
    },
    communications: {
      venueShareComms:  val('venueShareComms'),
      opsCenterOnSite:  val('opsCenterOnSite'),
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
      parkingNotes:     val('parkingNotes'),
      backstageControlled:   val('backstageControlled'),
      castCrewAccess:        val('castCrewAccess'),
      teamArrival:           val('teamArrival'),
      additionalCredentials: val('accessAddlCreds')
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
    noMapsProvided: !!document.getElementById('noMapsProvided')?.checked,
    mediaDay: {
      scheduled:  val('mediaScheduled'),
      timeWindow: val('mediaTimeWindow'),
      location:   val('mediaDayLocation'),
      escort:     val('mediaEscort'),
      notes:      val('mediaDayNotes')
    },
    travel:     window._travelersData || []
  };
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

function scheduleSave() {
  // Block saves until populateBrief has finished hydrating the form.
  // Without this, a slow Vercel cold-start fetch could let user typing land
  // before the server response, then populateBrief would clear those inputs
  // and the queued save would PUT empty values over the typed data.
  if (!briefLoaded) return;
  setStatus('Unsaved…', false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 900);
}

// Recursively shrink any base64 photos in the brief so the PUT stays under
// Vercel's serverless body limit (~4.5MB). Photos under 200KB are passed through.
async function _shrinkDataUrl(value, maxDim = 600, quality = 0.8) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) return value;
  if (value.length < 200 * 1024) return value; // already small enough
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = value;
    });
    let nw = img.width, nh = img.height;
    if (nw > maxDim || nh > maxDim) {
      if (nw >= nh) { nh = Math.round(nh * maxDim / nw); nw = maxDim; }
      else          { nw = Math.round(nw * maxDim / nh); nh = maxDim; }
    }
    const c = document.createElement('canvas');
    c.width = nw; c.height = nh;
    c.getContext('2d').drawImage(img, 0, 0, nw, nh);
    return c.toDataURL('image/jpeg', quality);
  } catch (_) { return value; }
}
async function _shrinkPhotosDeep(obj) {
  if (obj == null || typeof obj === 'boolean' || typeof obj === 'number') return obj;
  if (typeof obj === 'string') return _shrinkDataUrl(obj);
  if (Array.isArray(obj)) {
    const out = []; for (const v of obj) out.push(await _shrinkPhotosDeep(v)); return out;
  }
  if (typeof obj === 'object') {
    const out = {}; for (const k of Object.keys(obj)) out[k] = await _shrinkPhotosDeep(obj[k]); return out;
  }
  return obj;
}

async function doSave() {
  if (!currentBriefId) return;
  // Serialize PUTs so out-of-order Vercel responses can't clobber fresh data.
  if (_saveInFlight) { _savePending = true; return; }
  _saveInFlight = true;
  setStatus('Saving…', false);
  try {
    const data = await _shrinkPhotosDeep(collectBrief());
    const res = await fetch(`${API}/api/briefs/${currentBriefId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      let msg = 'Save failed';
      try { const j = await res.json(); if (j.error) msg = `Save failed — ${j.error}`; } catch (_) {}
      if (res.status === 413) msg = 'Save failed — payload too large. Try fewer/smaller photos.';
      throw new Error(msg);
    }
    setStatus('Saved ✓', true);
    updateDots();
  } catch (e) {
    setStatus(e.message || 'Save failed', false);
  } finally {
    _saveInFlight = false;
    if (_savePending) {
      _savePending = false;
      doSave();
    }
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
    btn.textContent = '✓ Published';
    btn.title = 'This brief is visible to Talent/Crew. Click to unpublish.';
    btn.style.background = 'rgba(34,197,94,0.15)';
    btn.style.color = '#22c55e';
    btn.style.borderColor = 'rgba(34,197,94,0.4)';
  } else {
    btn.textContent = 'Publish to Talent/Crew';
    btn.title = 'Make this brief visible to Talent/Crew portal users.';
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
    toast(_briefStatus === 'finalized' ? 'Published — visible to Talent/Crew' : 'Unpublished — back to draft', 'success');
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

// ── Same as Venue toggle (hotel address mirrors venue) ────────────────────────

const ADDR_PARTS = ['Street', 'City', 'State', 'Zip'];

// Normalized address key, matching how the view page decides "same as venue"
function addrKey(prefix) {
  return ADDR_PARTS
    .map(part => (document.getElementById(prefix + part)?.value || '').trim())
    .filter(Boolean).join(', ').toLowerCase();
}

function copyVenueToHotel() {
  let copied = 0;
  for (const part of ADDR_PARTS) {
    const src = document.getElementById('venue' + part);
    const dst = document.getElementById('hotel' + part);
    if (!src || !dst) continue;
    dst.value = src.value || '';
    copied++;
  }
  if (copied) syncDateTimeEmptyClasses();
}

function clearHotelAddress() {
  for (const part of ADDR_PARTS) {
    const dst = document.getElementById('hotel' + part);
    if (dst) dst.value = '';
  }
  syncDateTimeEmptyClasses();
}

// Reflect the real state: on only when the hotel address already matches the venue
function syncSameAsVenueToggle() {
  const cb = document.getElementById('hotelSameAsVenue');
  if (!cb) return;
  const v = addrKey('venue');
  cb.checked = !!v && v === addrKey('hotel');
}

function toggleSameAsVenue() {
  const cb = document.getElementById('hotelSameAsVenue');
  if (!cb) return;
  if (cb.checked) copyVenueToHotel(); else clearHotelAddress();
  scheduleSave();
}

document.addEventListener('DOMContentLoaded', () => {
  for (const part of ADDR_PARTS) {
    // Venue edits flow through to the hotel while the toggle is on
    document.getElementById('venue' + part)?.addEventListener('input', () => {
      if (document.getElementById('hotelSameAsVenue')?.checked) copyVenueToHotel();
      else syncSameAsVenueToggle();
    });
    // Hand-editing the hotel address turns the toggle off
    document.getElementById('hotel' + part)?.addEventListener('input', syncSameAsVenueToggle);
  }
  syncSameAsVenueToggle();
});

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
    { label: 'Arrival',   date: val('arrivalDate'),   time: '',               dateTBD: isTBD('arrivalDate'),   timeTBD: false                  },
    { label: 'Media Day', date: val('mediaDate'),     time: val('mediaTime'), dateTBD: false, timeTBD: false },
    { label: 'Show Day',  date: val('showDate'),      time: val('showTime'),  dateTBD: isTBD('showDate'),      timeTBD: isTBD('showTime')      },
    { label: 'Departure', date: val('departureDate'), time: '',               dateTBD: isTBD('departureDate'), timeTBD: false                  }
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
// Supports multiple show days. Storage shape:
//   single day (legacy):  runofshow = [{time, activity, notes, critical}, ...]
//   multi-day:            runofshow = [{label, rows: [...]}, {label, rows: [...]}]
// The table always shows one day at a time; tabs switch between days.

let _rosDays = [{ label: 'Day 1', rows: [] }];
let _rosActiveDay = 0;

function rosNormalizeDays(runofshow) {
  if (!Array.isArray(runofshow) || !runofshow.length) return [{ label: 'Day 1', rows: [] }];
  if (runofshow[0] && Array.isArray(runofshow[0].rows)) {
    return runofshow.map((d, i) => ({ label: d.label || `Day ${i + 1}`, rows: d.rows || [] }));
  }
  return [{ label: 'Day 1', rows: runofshow }];
}

function renderROSTable(runofshow) {
  _rosDays = rosNormalizeDays(runofshow);
  _rosActiveDay = 0;
  renderROSDayTabs();
  renderROSRows(_rosDays[0].rows);
}

function renderROSRows(rows) {
  const body = document.getElementById('rosBody');
  if (!body) return;
  body.innerHTML = '';
  rows.forEach(r => addROSRow(r));
}

function renderROSDayTabs() {
  const bar = document.getElementById('rosDayTabs');
  if (!bar) return;
  bar.innerHTML = _rosDays.map((d, i) => {
    const active = i === _rosActiveDay;
    return `<button class="btn btn-sm ${active ? '' : 'btn-ghost'}" style="${active ? 'background:var(--red);border-color:var(--red);color:#fff;font-weight:700;' : ''}" onclick="switchROSDay(${i})" ondblclick="renameROSDay(${i})" title="Double-click to rename">${esc(d.label)}</button>`;
  }).join('') +
  `<button class="btn btn-ghost btn-sm" onclick="addROSDay()" title="Add another show day (option to copy this day's schedule)">+ Add Day</button>` +
  (_rosDays.length > 1 ? `<button class="btn btn-ghost btn-sm" style="color:var(--red);border-color:rgba(230,57,70,0.3);" onclick="removeROSDay()" title="Delete the currently shown day">× Remove Day</button>` : '');
}

function syncActiveROSDay() {
  _rosDays[_rosActiveDay].rows = collectROSRows();
}

function switchROSDay(i) {
  if (i === _rosActiveDay || !_rosDays[i]) return;
  syncActiveROSDay();
  _rosActiveDay = i;
  renderROSDayTabs();
  renderROSRows(_rosDays[i].rows);
}

function addROSDay() {
  syncActiveROSDay();
  const cur = _rosDays[_rosActiveDay];
  const copy = cur.rows.length > 0 && confirm(`Copy "${cur.label}" schedule into the new day?\n\nOK = start with a copy of this day's rows\nCancel = start blank`);
  const label = (prompt('Label for the new day (e.g., "Day 2 — Aug 22")', `Day ${_rosDays.length + 1}`) || `Day ${_rosDays.length + 1}`).trim();
  _rosDays.push({ label, rows: copy ? JSON.parse(JSON.stringify(cur.rows)) : [] });
  _rosActiveDay = _rosDays.length - 1;
  renderROSDayTabs();
  renderROSRows(_rosDays[_rosActiveDay].rows);
  scheduleSave();
}

function renameROSDay(i) {
  const label = prompt('Rename this day', _rosDays[i].label);
  if (!label || !label.trim()) return;
  _rosDays[i].label = label.trim();
  renderROSDayTabs();
  scheduleSave();
}

function removeROSDay() {
  if (_rosDays.length < 2) return;
  const cur = _rosDays[_rosActiveDay];
  if (!confirm(`Delete "${cur.label}" and its ${collectROSRows().length} schedule rows?`)) return;
  _rosDays.splice(_rosActiveDay, 1);
  _rosActiveDay = Math.max(0, _rosActiveDay - 1);
  renderROSDayTabs();
  renderROSRows(_rosDays[_rosActiveDay].rows);
  scheduleSave();
}

// afterTr (optional): insert the new row directly below that row instead of appending.
// Time edits no longer auto-sort the table — rows jumping mid-edit made day-of changes
// painful. Use the explicit "Sort by Time" button instead.
function addROSRow(r = {}, afterTr = null) {
  const body = document.getElementById('rosBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.className = 'ros-row' + (r.critical ? ' ros-row-critical' : '');
  tr.draggable = true;
  tr.innerHTML = `
    <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
    <td><input class="ros-time-input" type="text" value="${esc(r.time || '')}" placeholder="19:00 / 1 hr prior" oninput="scheduleSave()"></td>
    <td><input class="ros-text-input" value="${esc(r.activity || '')}" placeholder="Activity description…" oninput="scheduleSave()"></td>
    <td><input class="ros-text-input" value="${esc(r.notes || '')}" placeholder="Security notes…" oninput="scheduleSave()"></td>
    <td style="text-align:center;">
      <label class="toggle" style="width:34px;height:18px;">
        <input type="checkbox" ${r.critical ? 'checked' : ''} onchange="this.closest('tr').className='ros-row'+(this.checked?' ros-row-critical':'');scheduleSave()">
        <span class="toggle-slider" style="border-radius:18px;"></span>
      </label>
    </td>
    <td style="white-space:nowrap;">
      <button class="btn btn-icon btn-ghost btn-xs" onclick="insertROSRowBelow(this)" title="Insert a row below this one">⤵</button>
      <button class="btn btn-icon btn-ghost btn-xs" onclick="this.closest('tr').remove();scheduleSave()" title="Delete row">×</button>
    </td>`;
  if (afterTr && afterTr.parentNode === body) body.insertBefore(tr, afterTr.nextSibling);
  else body.appendChild(tr);
  initROSDrag(tr);
  return tr;
}

function insertROSRowBelow(btn) {
  const tr = btn.closest('tr');
  const newTr = addROSRow({}, tr);
  newTr?.querySelector('.ros-time-input')?.focus();
  scheduleSave();
}

// Shift every timed row by ±N minutes — for when the whole show slips.
function shiftROSTimes() {
  const raw = prompt('Shift all times by how many minutes?\n(e.g. 30 = push everything 30 min later, -15 = pull 15 min earlier)');
  if (raw === null) return;
  const mins = parseInt(raw, 10);
  if (isNaN(mins) || !mins) { alert('Enter a number of minutes, like 30 or -15.'); return; }
  let shifted = 0;
  document.querySelectorAll('#rosBody .ros-time-input').forEach(inp => {
    // Only shift real clock times (HH:MM) — leave offsets like "1 hr prior" or "TBD" alone
    if (!/^\d{1,2}:\d{2}$/.test(inp.value.trim())) return;
    const [h, m] = inp.value.trim().split(':').map(Number);
    let total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
    inp.value = String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    shifted++;
  });
  if (shifted) { scheduleSave(); showToast(`Shifted ${shifted} rows by ${mins > 0 ? '+' : ''}${mins} min`); }
  else showToast('No clock times (HH:MM) to shift — offset rows like "1 hr prior" are left as-is');
}

function sortROSByTime() {
  const body = document.getElementById('rosBody');
  if (!body) return;
  // Only clock times (HH:MM) sort; offset/free-text rows ("1 hr prior", "TBD")
  // keep their manual position relative to each other, after the timed rows.
  const clock = t => /^\d{1,2}:\d{2}$/.test(t.trim()) ? t.trim().padStart(5, '0') : null;
  [...body.querySelectorAll('tr.ros-row')]
    .map((tr, idx) => ({ tr, idx, time: clock(tr.querySelector('.ros-time-input')?.value || '') }))
    .sort((a, b) => {
      if (!a.time && !b.time) return a.idx - b.idx;
      if (!a.time) return 1;
      if (!b.time) return -1;
      if (a.time === b.time) return a.idx - b.idx;
      return a.time < b.time ? -1 : 1;
    })
    .forEach(({ tr }) => body.appendChild(tr));
}

// Rows currently in the visible table (the active day)
function collectROSRows() {
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

// Full structure for saving: legacy flat array when there's a single day
// (keeps old briefs/printouts working), day objects when there are several.
function collectROS() {
  syncActiveROSDay();
  if (_rosDays.length === 1) return _rosDays[0].rows;
  return _rosDays.map(d => ({ label: d.label, rows: d.rows }));
}

async function saveROSTemplate() {
  const rows = collectROSRows();
  if (!rows.length) { alert('No rows to save.'); return; }
  if (!confirm(`Save ${rows.length} rows as the standard Run of Show template?`)) return;
  const r = await fetch('/api/ros-template', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) });
  if (r.ok) showToast('Standard template saved!');
  else showToast('Failed to save template', 'error');
}

async function loadROSTemplate() {
  const r = await fetch('/api/ros-template');
  const rows = await r.json();
  if (!rows.length) { alert('No template saved yet. Build your Run of Show and click "Save as Standard Template" first.'); return; }
  const existing = collectROSRows().length;
  if (existing && !confirm(`Replace the current ${existing} rows with the standard template?`)) return;
  document.getElementById('rosBody').innerHTML = '';
  rows.forEach(row => addROSRow(row));
  scheduleSave();
  showToast('Standard template loaded!');
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
  const pos = p.photoPosition || '50% 15%';
  const photoHtml = p.photo
    ? `<img src="${esc(p.photo)}" alt="" style="object-position:${esc(pos)};">`
    : `<span>${initials || '?'}</span>`;

  const isTalent = type === 'talent';

  div.innerHTML = `
    <button class="person-card-remove" onclick="this.closest('.person-card').remove();scheduleSave()" title="Remove">×</button>
    <div class="person-photo-wrap">
      <div class="person-photo" data-photo-position="${esc(pos)}" onclick="event.stopPropagation();openPhotoPicker(this)">
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
    _pickerTarget.dataset.photoPosition = '50% 15%';
    _pickerTarget.innerHTML = `<img src="${esc(url)}" alt="" style="object-position:50% 15%;"><div class="person-photo-overlay">📷</div>`;
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
    const nameInput  = card.querySelector('.person-name-input');
    const stageInput = card.querySelector('.person-stage-input');
    const roleInputs = [...card.querySelectorAll('.person-role-input')];
    const textarea   = card.querySelector('textarea');
    const photoDiv   = card.querySelector('.person-photo');
    const img        = photoDiv?.querySelector('img');
    const photoPosition = photoDiv?.dataset.photoPosition || img?.style.objectPosition || '';
    const type       = card.dataset.type;
    if (type === 'talent') {
      return { name: nameInput?.value || '', stageName: stageInput?.value || '', role: roleInputs[0]?.value || '', notes: textarea?.value || '', photo: img?.getAttribute('src') || '', photoPosition };
    } else {
      return { name: nameInput?.value || '', function: roleInputs[0]?.value || '', phone: roleInputs[1]?.value || '', notes: textarea?.value || '', photo: img?.getAttribute('src') || '', photoPosition };
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
  const pos = p.photoPosition || '50% 15%';
  const photoHtml = p.photo
    ? `<img src="${esc(p.photo)}" alt="" style="object-position:${esc(pos)};">`
    : `<span>${initials || '?'}</span>`;

  div.innerHTML = `
    <button class="person-card-remove" onclick="this.closest('.genx-staff-card').remove();updateGenxStaffCount();scheduleSave()" title="Remove">×</button>
    <div class="person-photo-wrap">
      <div class="person-photo" data-photo-position="${esc(pos)}" onclick="event.stopPropagation();openPhotoPicker(this)">
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

function enforceBackstageCap() {
  const totalEl = document.getElementById('totalSecurity');
  const backEl  = document.getElementById('backstageSecurity');
  if (!totalEl || !backEl) return;
  const total = Number(totalEl.value) || 0;
  const back  = Number(backEl.value) || 0;
  backEl.max = total > 0 ? total : '';
  if (total > 0 && back > total) backEl.value = total;
}

function updateGenxStaffCount() {
  const grid = document.getElementById('genxStaffGrid');
  if (!grid) return;
  const count = grid.querySelectorAll('.genx-staff-card').length;
  const countEl = document.getElementById('genxSecurity');
  if (countEl) countEl.value = count > 0 ? count : '';
  const mgEl = document.getElementById('mgGenxStaff');
  if (mgEl) mgEl.value = count > 0 ? count : '';
}

function collectGenxStaff() {
  const grid = document.getElementById('genxStaffGrid');
  if (!grid) return [];
  return [...grid.querySelectorAll('.genx-staff-card')].map(card => {
    const inputs  = [...card.querySelectorAll('input:not(.photo-input):not([type=hidden])')];
    const selects = [...card.querySelectorAll('select')];
    const photoDiv = card.querySelector('.person-photo');
    const img = photoDiv?.querySelector('img');
    const photoPosition = photoDiv?.dataset.photoPosition || img?.style.objectPosition || '';
    return {
      name:  inputs[0]?.value || '',
      role:  selects[0]?.value || '',
      phone: inputs[1]?.value || '',
      email: inputs[2]?.value || '',
      certs: [...card.querySelectorAll('.cert-tag input[type=hidden]')].map(i => i.value).filter(Boolean),
      photo: img?.getAttribute('src') || '',
      photoPosition
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

// When on, the maps grid is hidden but kept in the DOM so any already-uploaded
// maps still round-trip through collectMaps() untouched.
function toggleNoMaps(save = true) {
  const on   = !!document.getElementById('noMapsProvided')?.checked;
  const grid = document.getElementById('mapsGrid');
  const add  = document.getElementById('addMapBtn');
  if (grid) grid.style.display = on ? 'none' : '';
  if (add)  add.style.display  = on ? 'none' : '';
  if (save) { scheduleSave(); updateDots(); }
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
    medical:    () => val('firstResponderCount') || val('firstAidLocations') || val('emergencyProtocol'),
    evacuation: () => val('primaryExit'),
    meetgreet:  () => val('mgProtocol') || val('giftPolicy'),
    comms:      () => val('securityOps'),
    access:     () => collectDoorSystems().length > 0,
    genxstaff:  () => document.querySelectorAll('#genxStaffGrid .genx-staff-card').length > 0,
    loadin:     () => val('dockLocation'),
    ros:        () => document.querySelectorAll('#rosBody tr').length > 0,
    talent:     () => document.querySelectorAll('#talentGrid .person-card').length > 0,
    crew:       () => document.querySelectorAll('#crewGrid .person-card').length > 0,
    emergency:  () => document.querySelectorAll('#emergencyBody tr').length > 0,
    maps:       () => document.querySelectorAll('#mapsGrid .map-zone').length > 0
                        || !!document.getElementById('noMapsProvided')?.checked
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

// ══════════════════════════════════════════════════════════════════════════════
// PRINTED BRIEF
// ══════════════════════════════════════════════════════════════════════════════
// The screen view is built from cards and grids. Those never paginated well —
// boxes strand their headings, split down the middle, or get dropped whole by
// the print engine. The printed document is therefore its own flat layout:
// numbered sections, hairline rules, label/value rows and plain tables. Nothing
// is a box, so there is nothing that has to be kept together, and the page
// breaks fall wherever they land without damaging anything.

function pYN(v) {
  if (v === true  || v === 'yes') return 'Yes';
  if (v === false || v === 'no')  return 'No';
  return v;
}

let _pSectionNo = 0;
function pSection(title) {
  _pSectionNo += 1;
  return `<h2 class="pb-h2"><span class="pb-num">${_pSectionNo}.</span>${esc(title)}</h2>`;
}
function pSub(title) { return `<h3 class="pb-h3">${esc(title)}</h3>`; }

function pKv(pairs) {
  const rows = pairs.filter(p => isContentValue(p[1])).map(([k, v]) =>
    `<tr><th class="pb-k">${esc(k)}</th><td class="pb-v">${esc(String(v))}</td></tr>`).join('');
  return rows ? `<table class="pb-kv">${rows}</table>` : '';
}

function pText(label, body) {
  if (!isContentValue(body)) return '';
  return `${label ? `<h3 class="pb-h3">${esc(label)}</h3>` : ''}<p class="pb-p">${esc(body).replace(/\n/g, '<br>')}</p>`;
}

function pTable(headers, rows) {
  if (!rows.length) return '';
  return `<table class="pb-table">
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

// Personnel as a plain roster table: photo, name, role, contact. No cards.
function pRoster(people, opts = {}) {
  if (!people.length) return '';
  // Only carry a contact column when somebody in this group actually has
  // contact details — an empty column is dead space on the page.
  const anyContact = people.some(p => p.phone || p.email);
  const rows = people.map(p => {
    const detail = [p.role || p.function, p.stageName && p.stageName !== p.name ? p.stageName : '']
      .filter(Boolean).join(' — ');
    const contact = [p.phone, p.email].filter(Boolean).join('<br>');
    return `<tr>
      <td class="pb-photo">${p.photo
        ? `<img src="${esc(p.photo)}" alt="">`
        : `<span class="pb-initials">${esc(getInitials(p.name))}</span>`}</td>
      <td class="pb-person">
        <span class="pb-name">${esc(p.name || '')}</span>
        ${detail ? `<span class="pb-role">${esc(detail)}</span>` : ''}
        ${(p.certs || []).filter(Boolean).length ? `<span class="pb-role">${esc((p.certs || []).filter(Boolean).join(', '))}</span>` : ''}
        ${p.notes ? `<span class="pb-role">${esc(p.notes)}</span>` : ''}
      </td>
      ${anyContact ? `<td class="pb-contact">${contact || ''}</td>` : ''}
    </tr>`;
  }).join('');
  return `<table class="pb-roster">${rows}</table>`;
}

function buildPrintBrief(b) {
  _pSectionNo = 0;
  const v = b.venue || {}, h = b.hotel || {}, tl = b.timeline || {}, ct = b.contacts || {};
  const ing = b.ingress || {}, st = b.staffing || {}, med = b.medical || {}, ev = b.evacuation || {};
  const mg = b.meetgreet || {}, comm = b.communications || {}, ac = b.access || {}, li = b.loadinout || {};
  const cw = b.crowd || {};
  const addr = o => [o.street, o.city, o.state, o.zip].filter(Boolean).join(', ');
  const dt = (d, tbd) => tbd ? 'TBD' : (d ? formatDate(d) : '');
  const tm = (t, tbd) => tbd ? 'TBD' : (t ? formatTime(t) : '');
  const out = [];

  // ── Heading block ──────────────────────────────────────────────────────────
  const prepared = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Classification banner, repeated on every printed page. It has to live in
  // this document — the screen view is display:none in print, so anything
  // inside it never renders.
  out.push(`<div class="brief-print-footer">
    <span></span>
    <span>Confidential // GenX Corporate Security // ${esc((v.name || 'Security Brief').slice(0, 60))}</span>
    <span></span>
  </div>`);

  out.push(`<header class="pb-head">
    <img class="pb-logo" src="/genx-logo.png" alt="GenX Corporate Security">
    <div class="pb-doctype">Event Security Brief</div>
    <h1 class="pb-title">${esc(v.name || 'Security Brief')}</h1>
    <table class="pb-control">
      <tr><th>Event Date</th><td>${esc(dt(tl.showDate, tl.showDateTBD) || '—')}</td>
          <th>Location</th><td>${esc([v.city, v.state].filter(Boolean).join(', ') || '—')}</td></tr>
      <tr><th>Show Time</th><td>${esc(tm(tl.showTime, tl.showTimeTBD) || '—')}</td>
          <th>Doors</th><td>${esc(tm(tl.doorsTime, tl.doorsTimeTBD) || '—')}</td></tr>
      <tr><th>Prepared By</th><td>GenX Corporate Security</td>
          <th>Prepared</th><td>${esc(prepared)}</td></tr>
    </table>
  </header>`);

  // 1. Venue
  out.push(pSection('Venue'));
  out.push(pKv([['Location', v.name], ['Business Name', v.businessName], ['Address', addr(v)],
    ['Phone', v.phone], ['Capacity', v.capacity], ['Type', v.type]]));
  out.push(pText('Security Concerns — Past 12 Months', v.priorIncidents));

  // 2. Lodging
  const hasHotel = h.name || h.street || h.phone || h.checkin || h.checkout;
  const sameAsVenue = hasHotel && addr(v) && addr(v).toLowerCase() === addr(h).toLowerCase();
  if (hasHotel) {
    out.push(pSection('Lodging'));
    out.push(sameAsVenue
      ? pKv([['Lodging', 'Talent lodging on-site at venue'],
             ['Check-In', h.checkin ? formatDate(h.checkin) : ''],
             ['Check-Out', h.checkout ? formatDate(h.checkout) : '']])
      : pKv([['Hotel', h.name], ['Address', addr(h)], ['Phone', h.phone],
             ['Check-In', h.checkin ? formatDate(h.checkin) : ''],
             ['Check-Out', h.checkout ? formatDate(h.checkout) : '']]));
  }

  // 3. Timeline
  out.push(pSection('Event Timeline'));
  out.push(pKv([['Arrival', dt(tl.arrivalDate, tl.arrivalDateTBD)],
    ['Show Day', dt(tl.showDate, tl.showDateTBD)], ['Show Time', tm(tl.showTime, tl.showTimeTBD)],
    ['Doors', tm(tl.doorsTime, tl.doorsTimeTBD)], ['Departure', dt(tl.departureDate, tl.departureDateTBD)]]));
  out.push(pText('Timeline Notes', tl.notes));

  // 4. Security contacts
  out.push(pSection('Security Contacts'));
  const per = (o, label) => o && (o.name || o.cell || o.phone || o.email) ? [
    [label + ' — Name', o.name], [label + ' — Title', o.title || o.role],
    [label + ' — Cell', o.cell || o.phone], [label + ' — Email', o.email]] : [];
  out.push(pKv([...per(ct.primary, 'Primary'), ...per(ct.backup, 'Backup'),
    ['Law Enforcement On-Site', pYN(ct.leOnSite)], ['Agency', ct.leAgency]]));

  // 5. Entry & screening
  out.push(pSection('Entry & Guest Screening'));
  const methods = [['evolv', 'Evolv'], ['magnetometer', 'Magnetometer'], ['wand', 'Wand'],
    ['bagCheck', 'Bag Check'], ['patDown', 'Pat Down'], ['visualInspection', 'Visual Inspection']]
    .filter(([k]) => ing[k]).map(([, l]) => l).join(', ');
  out.push(pKv([['Screening Methods', methods], ['Ticketing', ing.ticketingType],
    ['Entry Points', ing.gateCount], ['Gates Open', ing.gateOpenTime ? formatTime(ing.gateOpenTime) : ''],
    ['Prohibited Items', (ing.prohibitedItems || []).join(', ')]]));
  out.push(pText('Entry Notes', ing.notes));
  const crowdRows = pKv([['Barricade Needed', pYN(cw.barricadeNeeded)], ['Audience', cw.audienceType],
    ['Barricade at Stage', pYN(cw.barricadeAtStage)]]);
  if (crowdRows) { out.push(pSub('Crowd & Barricade')); out.push(crowdRows); }

  // 6. Staffing
  out.push(pSection('Staffing'));
  out.push(pKv([['Total Security', st.totalSecurity], ['Law Enforcement', st.leo],
    ['Backstage Security', st.backstageSecurity], ['GenX Security', st.genxSecurity],
    ['Uniformed', pYN(st.uniformed)], ['Uniform', st.uniformDesc]]));
  out.push(pText('Staffing Notes', st.notes));

  // 7. Medical
  out.push(pSection('Medical & Emergency'));
  out.push(pKv([['Trained Medical Staff On-Site', pYN(med.onSite)], ['Responder Count', med.firstResponderCount],
    ['First Aid Location', med.firstAidLocations], ['AED On Site', pYN(med.aedOnSite)],
    ['AED Near Stage', pYN(med.aedNearStage)], ['Medical to Green Room', pYN(med.toGreenRoom)]]));
  out.push(pText('Emergency Protocol', med.emergencyProtocol));

  // 8. Evacuation
  out.push(pSection('Evacuation'));
  out.push(pKv([['Primary Exit', ev.primaryExit], ['Secondary Exit', ev.secondaryExit],
    ['Rally Point', ev.rallyPoint], ['Safe Rooms', (ev.safeRooms || []).join(', ')],
    ['Announcement Method', med.announcementMethod]]));
  out.push(pText('EAP Notes', ev.eapNotes));
  out.push(pText('Lockdown Protocol', ev.lockdownProtocol));
  out.push(pText('Weather Plan', ev.weatherPlan));

  // 9. Meet & greet
  out.push(pSection('Meet & Greet / Gift Policy'));
  out.push(pKv([['Scheduled', pYN(mg.scheduled)], ['Time', mg.time], ['Duration', mg.duration],
    ['Location', mg.location], ['Total VIPs', mg.totalVips], ['GenX Staff Assigned', mg.genxStaff]]));
  out.push(pText('M&G Protocol', mg.protocol));
  out.push(pText('Gift Policy', mg.giftPolicy));

  // 10. Communications
  out.push(pSection('Communications'));
  out.push(pKv([['Venue Shares Comms', pYN(comm.venueShareComms)],
    ['Ops Center On Site', pYN(comm.opsCenterOnSite)], ['Security Operations', comm.securityOps],
    ['Ops Phone', comm.securityOpsPhone], ['Cell Coverage OK', pYN(comm.cellOk)]]));
  const chans = (comm.channels || []).filter(c => c && (c.num || c.use));
  if (chans.length) { out.push(pSub('Radio Channels'));
    out.push(pTable(['Channel', 'Assignment'], chans.map(c => [esc(String(c.num || '')), esc(c.use || '')]))); }
  out.push(pText('Comms Notes', comm.notes));

  // 11. Access control
  out.push(pSection('Access Control'));
  out.push(pKv([['Venue Access Devices', (ac.doorSystems || []).join(', ')],
    ['Backstage Access-Controlled', pYN(ac.backstageControlled)],
    ['Additional Credentials (Venue-Stated)', ac.additionalCredentials]]));
  const creds = (ac.credentials || []).filter(c => c && c.name);
  if (creds.length) { out.push(pSub('Venue-Required Credentials'));
    out.push(pTable(['Credential', 'Color', 'Access Level', 'Location'],
      creds.map(c => [esc(c.name || ''), esc(c.color || ''), esc(c.level || ''), esc(c.location || '')]))); }
  const gc = ac.genxCred || {};
  if (gc.frontImage || gc.backImage || gc.name) {
    out.push(pSub('GenX Security Credentials'));
    out.push(pKv([['Credential', gc.name], ['Issued By', gc.issuedBy], ['Notes', gc.notes]]));
    out.push(`<div class="pb-creds">
      ${gc.frontImage ? `<figure><img src="${esc(gc.frontImage)}" alt=""><figcaption>Front</figcaption></figure>` : ''}
      ${gc.backImage  ? `<figure><img src="${esc(gc.backImage)}" alt=""><figcaption>Back</figcaption></figure>` : ''}
    </div>`);
  }
  if (b.cctv && (b.cctv.coverage || b.cctv.monitored || isContentValue(b.cctv.notes))) {
    out.push(pSub('CCTV & Surveillance'));
    out.push(pKv([['Coverage', pYN(b.cctv.coverage)], ['Monitored Live', pYN(b.cctv.monitored)]]));
    out.push(pText('', b.cctv.notes));
  }
  out.push(pText('Cast & Crew Access', ac.castCrewAccess));
  out.push(pText('GenX Arrival — Door / Meet / Time', ac.teamArrival));
  out.push(pText('Parking Notes', ac.parkingNotes));

  // 12. Load in / out
  out.push(pSection('Load In / Load Out'));
  out.push(pKv([['Load In Date', li.loadinDate ? formatDate(li.loadinDate) : ''],
    ['Load In Time', li.loadinTime ? formatTime(li.loadinTime) : ''], ['Dock Location', li.dockLocation],
    ['Load Out Date', li.loadoutDate ? formatDate(li.loadoutDate) : ''],
    ['Load Out Time', li.loadoutTime ? formatTime(li.loadoutTime) : ''],
    ['Vehicle Count', li.vehicleCount], ['Security At Dock', pYN(li.securityAtDock)]]));
  out.push(pText('Load In Notes', li.loadinNotes));
  out.push(pText('Load Out Notes', li.loadoutNotes));

  // 13. Run of show
  const days = rosNormalizeDays(b.runofshow || []).filter(d => d.rows.length);
  if (days.length) {
    out.push(pSection('Run of Show'));
    days.forEach(d => {
      if (days.length > 1) out.push(pSub(d.label));
      out.push(pTable(['Time', 'Activity', 'Security Notes'], d.rows.map(r => [
        `<span class="pb-time">${esc(r.time ? formatTime(r.time) : '')}</span>`,
        (r.critical ? '<strong>' : '') + esc(r.activity || '') + (r.critical ? '</strong>' : ''),
        esc(r.notes || '')])));
    });
  }

  // 14-16. Personnel
  if ((b.talent || []).length)    { out.push(pSection('Talent'));              out.push(pRoster(b.talent)); }
  if ((b.crew || []).length)      { out.push(pSection('Crew & Production'));   out.push(pRoster(b.crew)); }
  if ((b.genxstaff || []).length) { out.push(pSection('GenX Security Staff')); out.push(pRoster(b.genxstaff)); }

  // 17. Emergency contacts
  if ((b.emergency || []).length) {
    out.push(pSection('Emergency Contacts'));
    out.push(pTable(['Role', 'Name', 'Phone', 'Email'], b.emergency.map(e =>
      [esc(e.role || ''), esc(e.name || ''), esc(e.phone || ''), esc(e.email || '')])));
  }

  // 18. Maps
  const maps = (b.maps || []).filter(m => m.image);
  if (maps.length) {
    out.push(pSection('Venue Maps & Diagrams'));
    maps.forEach(m => out.push(`<figure class="pb-map">
      <img src="${esc(m.image)}" alt="">
      <figcaption>${esc(m.title || '')}${m.description ? ' — ' + esc(m.description) : ''}</figcaption>
    </figure>`));
  } else if (b.noMapsProvided) {
    out.push(pSection('Venue Maps & Diagrams'));
    out.push(`<p class="pb-p">No maps provided to security team.</p>`);
  }

  out.push(`<div class="pb-end">— End of Brief —</div>`);
  out.push(`<div class="brief-print-tail" aria-hidden="true"></div>`);
  return out.filter(Boolean).join('\n');
}

// ── Email-friendly PDF export ────────────────────────────────────────────────
// Uses the browser's print pipeline (which is the only thing that renders the
// brief layout correctly) and pre-shrinks every photo to ~800px JPEG before
// opening the print dialog. Three lessons baked in: (1) wait for every image
// to fully load before measuring — otherwise huge maps with `naturalWidth=0`
// get skipped and print at full resolution; (2) after swapping in a shrunk
// data URI, wait for the swap to actually load — revert that specific image
// if it doesn't, so a corrupted shrink never blanks a photo; (3) no timeout
// fallback on restore — only afterprint — so a slow Save dialog never reverts
// to full-res originals mid-print.
// Safari sizes a print job from the document's NATURAL height, then paginating
// adds white space — every box that will not fit in the room left on a page is
// pushed whole to the next one — so the laid-out document ends up taller than
// the estimate and everything past the estimate is silently dropped. Measured:
// a brief whose Safari preview showed 8 pages saved 8 pages that ended at
// Talent, with Crew, GenX Staff and Emergency Contacts missing entirely.
//
// Keeping sections whole is what makes the brief readable, and it is also what
// creates that white space, so the shortfall grows with the number of sections.
// Real trailing height raises the estimate; anything unused is clipped
// harmlessly. Applied only in Safari — Chrome paginates from the real layout
// and would just emit blank pages.
function sizePrintTail() {
  const tail = document.querySelector('.brief-print-tail');
  if (!tail) return;
  const ua = navigator.userAgent;
  const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android|edg|opr/i.test(ua);
  if (!isSafari) { tail.style.height = '0'; return; }
  const boxes = document.querySelectorAll('#briefDocument .view-panel').length;
  // A box that does not fit can strand most of a page. Budget generously —
  // trailing blank pages are recoverable, dropped personnel are not.
  tail.style.height = Math.min(34, 8 + boxes * 1.2).toFixed(1) + 'in';
}

// ── Print preview ────────────────────────────────────────────────────────────
// Shows the printed brief on screen at true letter width with a dashed rule
// drawn at every page boundary, so page breaks are visible before printing
// rather than after. Same markup and the same measurements the printer uses.
function togglePrintPreview() {
  const on = document.body.classList.toggle('print-preview');
  const label = document.getElementById('previewBtnLabel');
  if (label) label.textContent = on ? 'Exit Preview' : 'Preview Pages';
  if (on) requestAnimationFrame(() => requestAnimationFrame(drawPreviewPageBreaks));
  else document.querySelectorAll('.pp-break').forEach(el => el.remove());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Marks where each page actually begins, not where a ruler would fall. The
// printer never splits a table row, a roster line, a figure or the badge pair
// — anything that would straddle the boundary is pushed whole to the next page
// — so the preview walks those same units and breaks where the printer will.
// Drawing a line every page-height instead put the marker through the middle
// of rows that never get cut.
function drawPreviewPageBreaks() {
  const doc = document.getElementById('printDocument');
  if (!doc) return;
  doc.querySelectorAll('.pp-break').forEach(el => el.remove());

  const pageH  = (11 - 0.7 - 1.15) * 96;   // letter less the printed margins, at 96dpi
  const docTop = doc.getBoundingClientRect().top + window.scrollY;

  // The atomic units the print rules guarantee are never split.
  const units = [];
  for (const el of doc.children) {
    if (el.classList.contains('pp-break')) continue;
    if (el.tagName === 'TABLE') el.querySelectorAll('tr').forEach(tr => units.push(tr));
    else units.push(el);
  }

  let pageStart = 0, page = 1, oversize = 0;
  for (const u of units) {
    const r   = u.getBoundingClientRect();
    const top = r.top + window.scrollY - docTop;
    if (r.height > pageH) { oversize++; continue; }   // taller than a page: it must split
    if (top + r.height - pageStart > pageH) {
      pageStart = top;
      page += 1;
      const rule = document.createElement('div');
      rule.className = 'pp-break';
      rule.style.top = top + 'px';
      rule.dataset.page = 'Page ' + page;
      doc.appendChild(rule);
    }
  }
  const label = document.getElementById('previewBtnLabel');
  if (label) label.textContent = `Exit Preview · ${page} page${page === 1 ? '' : 's'}`;
  if (oversize) console.warn('[preview] %d block(s) taller than a page will split', oversize);
}

// Safari sizes a print job from the document's natural height, then pagination
// adds white space and anything past the estimate is dropped. Real trailing
// height raises the estimate; unused slack is clipped harmlessly. Safari only —
// Chrome paginates from the real layout and would just emit blank pages.
function sizePrintTail() {
  const tail = document.querySelector('#printDocument .brief-print-tail');
  if (!tail) return;
  const ua = navigator.userAgent;
  const isSafari = /safari/i.test(ua) && !/chrome|chromium|crios|android|edg|opr/i.test(ua);
  if (!isSafari) { tail.style.height = '0'; return; }
  const blocks = document.querySelectorAll('#printDocument .pb-h2, #printDocument table').length;
  tail.style.height = Math.min(24, 4 + blocks * 0.4).toFixed(1) + 'in';
}

async function downloadEmailPDF() {
  sizePrintTail();

  sizePrintTail();

  const btn   = document.getElementById('downloadPdfBtn');
  const label = document.getElementById('downloadPdfBtnLabel');
  const doc   = document.getElementById('briefDocument');
  if (!doc) return;
  // A tab that has been open across a deploy still holds the OLD app.js and
  // style.css, so it prints the old layout no matter what has been fixed
  // server-side. Check the build stamp first and reload once if we are stale,
  // resuming the print automatically afterwards.
  if (!sessionStorage.getItem('gxPrintReloaded')) {
    try {
      const meta = document.querySelector('meta[name="build"]')?.content;
      const live = await fetch('/api/build', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null);
      if (meta && live?.build && String(live.build) !== String(meta)) {
        sessionStorage.setItem('gxPrintReloaded', '1');
        sessionStorage.setItem('gxPrintAfterReload', '1');
        if (label) label.textContent = 'Updating…';
        location.reload();
        return;
      }
    } catch (_) { /* build check is best-effort — never block printing */ }
  }
  sessionStorage.removeItem('gxPrintReloaded');

  const prevLabel = label?.textContent;
  const resetButton = () => {
    if (btn)   btn.disabled = false;
    if (label) label.textContent = prevLabel || 'Print / Export PDF';
  };
  if (btn)   btn.disabled = true;
  if (label) label.textContent = 'Loading images…';

  const MAX_DIM = 800;
  const JPEG_Q  = 0.72;
  const imgs    = [...document.querySelectorAll('#briefDocument img, #printDocument img')];
  const originals = new Map();

  const restore = () => {
    for (const [img, src] of originals) img.src = src;
    originals.clear();
  };

  try {
    // 1. Wait for every image to finish loading. Large embedded maps in
    //    particular can still be decoding when the user clicks the button.
    await Promise.all(imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(resolve => {
        const done = () => resolve();
        img.addEventListener('load',  done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 10000);
      });
    }));

    if (label) label.textContent = 'Compressing…';

    // 2. Pre-validate each shrunk JPEG with a throwaway <Image> *before*
    //    swapping the live element's src. That way the live element only ever
    //    holds an src we know decodes to a non-blank image — no risk of a
    //    silently-broken JPEG replacing a working photo.
    for (const img of imgs) {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) continue;
      // Always re-encode PNGs, whatever their size. Safari's print pipeline
      // silently omits PNGs carrying an alpha channel — the image is laid out
      // (the box keeps its height) but never painted, so the PDF shows an
      // empty space where the credential badges should be. Drawing onto a
      // white-filled canvas and re-encoding as JPEG removes the alpha.
      const isPng = /^data:image\/png/i.test(img.src || '') || /\.png(\?|$)/i.test(img.src || '');
      if (Math.max(w, h) <= MAX_DIM && !isPng) continue;

      const scale = Math.min(1, MAX_DIM / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c  = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      let shrunk;
      try {
        ctx.drawImage(img, 0, 0, cw, ch);
        shrunk = c.toDataURL('image/jpeg', JPEG_Q);
      } catch (_) {
        continue; // Tainted canvas — leave original
      }
      if (!shrunk || shrunk.length < 200) continue;

      // Verify the shrunk URI actually decodes back to a real image.
      const verified = await new Promise(resolve => {
        const test = new Image();
        let done = false;
        const finish = ok => { if (!done) { done = true; resolve(ok); } };
        test.onload  = () => finish(test.naturalWidth > 0 && test.naturalHeight > 0);
        test.onerror = () => finish(false);
        setTimeout(() => finish(false), 4000);
        test.src = shrunk;
      });
      if (!verified) continue;

      originals.set(img, img.src);
      img.src = shrunk;
    }

    // 3. After all swaps, make sure every <img> in the brief is in a
    //    fully-loaded state before triggering the print dialog. This catches
    //    any in-flight decode of a freshly-set src — the print would otherwise
    //    capture a half-painted image as blank.
    await Promise.all(imgs.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load',  resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    }));
    // 3b. Wait for the webfont too. Montserrat loads from Google Fonts, and if
    //     it lands *after* the print job has been paginated the text metrics
    //     change underneath it — the document grows past the page count the
    //     engine already committed to and the tail is silently cut. This is a
    //     classic cause of "it printed but the last page is missing".
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise(r => setTimeout(r, 5000))
      ]);
    }

    // One more rAF for layout to settle.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    if (label) label.textContent = 'Print dialog…';

    // 4. Do NOT swap the full-resolution images back in. afterprint fires when
    //    the print sheet closes, but Safari's "Save as PDF" writes the file
    //    after that — restoring there re-lays-out the document mid-capture and
    //    can cost the last page. The on-screen view keeps the 800px versions
    //    until the next reload, which is indistinguishable at display size.
    originals.clear();
    window.addEventListener('afterprint', resetButton, { once: true });
    window.print();
    resetButton();
  } catch (e) {
    console.error('[PDF export]', e);
    alert('Could not prepare PDF — see console.');
    restore();
    resetButton();
  }
}

async function initBriefView(id) {
  try {
    const res = await fetch(`${API}/api/briefs/${id}`);
    if (!res.ok) throw new Error('Not found');
    const brief = await res.json();
    renderBriefView(brief, id);
    if (sessionStorage.getItem('gxPrintAfterReload')) {
      sessionStorage.removeItem('gxPrintAfterReload');
      setTimeout(() => downloadEmailPDF(), 300);
    }
  } catch (e) {
    const doc = document.getElementById('briefDocument');
    if (doc) doc.innerHTML = '<div style="text-align:center;padding:80px;color:var(--text-2);">Brief not found.</div>';
  }
}

function renderBriefView(b, id) {
  window._viewBrief = b;
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
  // The risk assessment is its own document (see /risk). It is deliberately
  // NOT part of the security brief — not on screen and not in the printout.


  const doc = document.getElementById('briefDocument');
  if (!doc) return;

  // The printed brief is its own flat layout — see buildPrintBrief(). Screen
  // shows #briefDocument, paper shows #printDocument; print CSS swaps them.
  const printDoc = document.getElementById('printDocument');
  if (printDoc) {
    try { printDoc.innerHTML = buildPrintBrief(b); }
    catch (e) { console.error('[print brief]', e); }
  }

  const _preparedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const _footerVenue = (v.name || 'Security Brief').slice(0, 80);
  const _footerDate  = tl.showDate ? formatDate(tl.showDate) : '';
  doc.innerHTML = `
    <!-- Print-only running footer (repeats on every printed page) -->
    <div class="brief-print-footer">
      <span>CONFIDENTIAL</span>
      <span>Confidential // GenX Corporate Security // ${esc(_footerVenue)}</span>
      <span>Prepared ${esc(_preparedDate)}</span>
    </div>

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
            <div style="margin-top:10px;font-size:10.5px;color:var(--text-3);letter-spacing:0.3px;">Prepared by GenX Corporate Security · ${esc(_preparedDate)}</div>
          </div>
          <div class="brief-header-logo">
            <img src="/genx-logo.png" alt="GenX Corporate Security" style="width:160px;height:160px;object-fit:contain;">
          </div>
        </div>
      </div>
    </div>


    <!-- Venue + Hotel -->
    ${(() => {
      const vAddr = [v.street, v.city, v.state, v.zip].filter(Boolean).join(', ').toLowerCase();
      const hAddr = [h.street, h.city, h.state, h.zip].filter(Boolean).join(', ').toLowerCase();
      const hasHotel = h.name || h.street || h.phone || h.checkin || h.checkout;
      const sameAsVenue = hasHotel && vAddr && hAddr && vAddr === hAddr;
      const venueCard = viewPanel('🏛️', 'Venue', `
        <div class="view-kv">
          ${kv('Location', v.name)}
          ${kv('Business Name', v.businessName)}
          ${kv('Address',  [v.street, v.city, v.state, v.zip].filter(Boolean).join(', '))}
          ${kv('Phone',    v.phone)}
          ${kv('Capacity',       v.capacity)}
          ${kv('Type',           v.type)}
        </div>
        ${isContentValue(v.priorIncidents) ? `<div style="margin-top:10px;"><div class="freetext-label" style="color:var(--red);">Security Concerns — Past 12 Months</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(v.priorIncidents)}</div></div>` : ''}
        ${sameAsVenue ? `<div style="margin-top:12px;font-size:14px;font-weight:600;color:var(--text-2);font-style:italic;">Talent lodging on-site at venue${h.checkin ? ` · Check-in ${formatDate(h.checkin)}` : ''}${h.checkout ? ` · Check-out ${formatDate(h.checkout)}` : ''}</div>` : ''}`);
      const hotelCard = hasHotel && !sameAsVenue ? viewPanel('🏨', 'Hotel', `
        <div class="view-kv">
          ${kv('Name',      h.name)}
          ${kv('Address',   [h.street, h.city, h.state, h.zip].filter(Boolean).join(', '))}
          ${kv('Phone',     h.phone)}
          ${kv('Check-In',  h.checkin ? formatDate(h.checkin) : '')}
          ${kv('Check-Out', h.checkout ? formatDate(h.checkout) : '')}
        </div>`) : '';
      return hotelCard
        ? `<div class="grid-2" style="margin-bottom:20px;">${venueCard}${hotelCard}</div>`
        : `<div style="margin-bottom:20px;">${venueCard}</div>`;
    })()}

    <!-- Timeline -->
    ${viewPanel('📅', 'Event Timeline', `
      <div class="grid-4" style="margin-bottom:16px;">
        ${miniStat('Arrival',   tl.arrivalDateTBD   ? 'TBD' : (tl.arrivalDate   ? formatDate(tl.arrivalDate)   : '—'), '')}
        ${miniStat('Show Day',  tl.showDateTBD      ? 'TBD' : (tl.showDate      ? formatDate(tl.showDate)      : '—'), tl.showTimeTBD      ? 'TBD' : (tl.showTime      ? 'Show ' + formatTime(tl.showTime)      : ''))}
        ${miniStat('Doors',     tl.doorsTimeTBD     ? 'TBD' : (tl.doorsTime     ? formatTime(tl.doorsTime)     : '—'), '')}
        ${miniStat('Departure', tl.departureDateTBD ? 'TBD' : (tl.departureDate ? formatDate(tl.departureDate) : '—'), '')}
      </div>
      ${isContentValue(tl.notes) ? `<div style="margin-top:6px;"><div class="freetext-label">Timeline Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(tl.notes)}</div></div>` : ''}`)}

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
      </div>
      ${(ct.leOnSite || ct.leAgency) ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Law Enforcement</div><div class="view-kv">${kv('Officers On-Site', ct.leOnSite === 'yes' ? 'Yes' : ct.leOnSite === 'no' ? 'No' : '')}${kv('Agency', ct.leAgency)}</div></div>` : ''}`)}

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
        ${(b.crowd && (b.crowd.needed || b.crowd.audience || b.crowd.barricadeType || b.crowd.stageBarricade || isContentValue(b.crowd.notes))) ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Crowd &amp; Barricade</div><div class="view-kv">${kv('Barricade Needed', b.crowd.needed === 'yes' ? 'Yes' : b.crowd.needed === 'no' ? 'No' : '')}${kv('Audience', b.crowd.audience)}${kv('Barricade Type', b.crowd.barricadeType)}${kv('Barricade at Stage', b.crowd.stageBarricade === 'yes' ? 'Yes' : b.crowd.stageBarricade === 'no' ? 'No' : '')}</div>${isContentValue(b.crowd.notes) ? `<div style="margin-top:8px;"><div class="freetext-label">Crowd Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(b.crowd.notes)}</div></div>` : ''}</div>` : ''}
        ${isContentValue(ing.notes) ? `<div style="margin-top:14px;"><div class="freetext-label">Prohibited Items / Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ing.notes)}</div></div>` : ''}`)}
      ${viewPanel('👮', 'Staffing', `
        <div class="grid-3" style="gap:8px;margin-bottom:12px;">
          ${miniStat('Security', st.totalSecurity || '—', '')}
          ${miniStat('LEO', st.leo || '—', '')}
          ${miniStat('Backstage', st.backstageSecurity || '—', '')}
          ${st.genxSecurity ? miniStat('GenX Security', st.genxSecurity, '') : ''}
        </div>
        ${st.uniformed && st.uniformDesc ? `<div style="margin-top:10px;"><div class="freetext-label">Uniform</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(st.uniformDesc)}</div></div>` : ''}
        ${isContentValue(st.notes) ? `<div style="margin-top:10px;"><div class="freetext-label">Staffing Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(st.notes)}</div></div>` : ''}`)}
    </div>

    <!-- Medical & Evacuation -->
    <div class="grid-2" style="margin-bottom:20px;">
      ${viewPanel('⚕️', 'Medical & Emergency', `
        <div class="view-kv">
          ${kv('Trained Medical Staff', med.onSite ? 'Yes' : 'No')}
          ${kv('Medical Personnel', med.firstResponderCount)}
          ${kv('AED On Site', med.aedOnSite ? 'Yes' : 'No')}
          ${kv('AED Near Stage', med.aedNearStage ? 'Yes' : 'No')}
          ${kv('Closest First Aid to Backstage', med.firstAidLocations)}
          ${kv('Medical to Green Room', med.toGreenRoom === 'yes' ? 'Yes' : med.toGreenRoom === 'no' ? 'No' : '')}
        </div>
        ${isContentValue(med.emergencyProtocol) ? `<div style="margin-top:10px;"><div class="freetext-label">Emergency Protocol</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(med.emergencyProtocol)}</div></div>` : ''}`)}
      ${viewPanel('🚨', 'Evacuation', `
        <div class="view-kv">
          ${kv('Primary Exit',   ev.primaryExit)}
          ${kv('Secondary Exit', ev.secondaryExit)}
          ${kv('Rally Point',    ev.rallyPoint)}
          ${kv('Evacuation Announcement', med.announcementMethod)}
        </div>
        ${(() => {
          const sr = (ev.safeRooms || []).filter(isContentValue);
          return sr.length ? `<div style="margin-top:10px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:5px;">Safe Rooms</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${sr.map(r => `<span class="tag tag-blue">${esc(r)}</span>`).join('')}</div></div>` : '';
        })()}
        ${isContentValue(ev.eapNotes) ? `<div style="margin-top:10px;"><div class="freetext-label">EAP Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ev.eapNotes)}</div></div>` : ''}
        ${isContentValue(ev.lockdownProtocol) ? `<div style="margin-top:10px;"><div class="freetext-label" style="color:var(--red);">Lockdown Protocol</div><div class="freetext-body" style="color:var(--red);white-space:pre-wrap;line-height:1.6;">${esc(ev.lockdownProtocol)}</div></div>` : ''}
        ${isContentValue(ev.weatherPlan) ? `<div style="margin-top:10px;"><div class="freetext-label">Weather / Show-Stop Plan</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ev.weatherPlan)}</div></div>` : ''}`)}
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
        ${isContentValue(mg.protocol) ? `<div style="margin-top:10px;"><div class="freetext-label">M&amp;G Protocol</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(mg.protocol)}</div></div>` : ''}` :
        '<div style="color:var(--text-3);font-size:13px;">No Meet &amp; Greet scheduled.</div>'}`)}
      ${viewPanel('📻', 'Communications', `
        <div class="view-kv">
          ${kv('Venue Shares Comms', co.venueShareComms ? 'Yes' : 'No')}
          ${kv('Ops Center On Site', co.opsCenterOnSite === 'yes' ? 'Yes' : co.opsCenterOnSite === 'no' ? 'No' : '')}
          ${kv('Security Operations', co.securityOps)}
          ${kv('Sec Ops Phone', co.securityOpsPhone)}
          ${kv('Cell OK', co.cellOk ? 'Yes' : 'No')}
        </div>
        ${(co.channels || []).length ? `<div style="margin-top:12px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Radio Channels</div><div class="channel-grid">${co.channels.map(ch => `<div class="channel-row"><div class="channel-num" style="font-weight:800;">${esc(ch.ch)}</div><div class="channel-use">${esc(ch.use)}</div></div>`).join('')}</div></div>` : ''}`)}
    </div>

    <!-- Media / Press Day -->
    ${(b.mediaDay && ((b.mediaDay.scheduled === true || b.mediaDay.scheduled === 'yes') || isContentValue(b.mediaDay.location) || isContentValue(b.mediaDay.notes))) ? viewPanel('📰', 'Media / Press Day', `
      <div class="view-kv">
        ${kv('Scheduled', (b.mediaDay.scheduled === true || b.mediaDay.scheduled === 'yes') ? 'Yes' : (b.mediaDay.scheduled === false || b.mediaDay.scheduled === 'no') ? 'No' : '')}
        ${kv('Date', tl.mediaDate ? formatDate(tl.mediaDate) : '')}
        ${kv('Time Window', b.mediaDay.timeWindow)}
        ${kv('Location', b.mediaDay.location)}
        ${kv('Escorted', b.mediaDay.escort === 'yes' ? 'Yes' : b.mediaDay.escort === 'no' ? 'No' : '')}
      </div>
      ${isContentValue(b.mediaDay.notes) ? `<div style="margin-top:10px;"><div class="freetext-label">Media Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(b.mediaDay.notes)}</div></div>` : ''}`) : ''}

    <!-- Access Control -->
    <!-- Access Control — ONE box, matching the edit form's single Access
         Control section (devices, credentials, GenX badges, CCTV, parking).
         Whatever is grouped in the form stays grouped on the page. -->
    ${viewPanel('🔑', 'Access Control', `
      ${(ac.doorSystems || []).length ? `<div style="margin-bottom:12px;"><div class="freetext-label">Venue Access Control Devices</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${(ac.doorSystems || []).map(s => `<span class="tag tag-gray">${esc(s)}</span>`).join('')}</div></div>` : ''}
      ${(ac.credentials || []).length ? `
        <div style="margin-top:4px;">
          <div class="freetext-label">Additional Venue-Required Credentials</div>
          <table class="data-table">
            <thead><tr><th>Credential</th><th>Color</th><th>Access Level</th><th>Location</th><th>Image</th></tr></thead>
            <tbody>
              ${(ac.credentials || []).map(c => `<tr><td style="font-weight:600;">${esc(c.name)}</td><td><span class="tag tag-gray">${esc(c.color)}</span></td><td style="color:var(--text-2);">${esc(c.level)}</td><td style="color:var(--text-2);">${esc(c.location || '')}</td><td>${c.image ? `<img src="${esc(c.image)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">` : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
      ${ac.genxCred && (ac.genxCred.frontImage || ac.genxCred.backImage || ac.genxCred.name) ? `
        <div style="margin-top:14px;">
          <div class="freetext-label">GenX Security Credentials</div>
          <div class="cred-card" style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px;">
            ${ac.genxCred.name ? `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">${esc(ac.genxCred.name)}</div>` : ''}
            ${ac.genxCred.issuedBy ? `<div style="font-size:11px;color:var(--text-3);margin-bottom:12px;">Issued by: ${esc(ac.genxCred.issuedBy)}</div>` : ''}
            <div class="cred-img-row" style="display:flex;gap:16px;flex-wrap:wrap;">
              ${ac.genxCred.frontImage ? `<div style="flex:1;min-width:120px;max-width:200px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Front</div><img class="brief-cred-img" src="${esc(ac.genxCred.frontImage)}" style="width:100%;border-radius:8px;aspect-ratio:0.63;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>` : ''}
              ${ac.genxCred.backImage  ? `<div style="flex:1;min-width:120px;max-width:200px;"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Back</div><img class="brief-cred-img" src="${esc(ac.genxCred.backImage)}" style="width:100%;border-radius:8px;aspect-ratio:0.63;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>` : ''}
            </div>
            ${ac.genxCred.notes ? `<div style="margin-top:10px;font-size:12px;color:var(--text-2);">${esc(ac.genxCred.notes)}</div>` : ''}
          </div>
        </div>` : ''}
      ${(b.cctv && (b.cctv.coverage || b.cctv.monitored || isContentValue(b.cctv.notes))) ? `<div style="margin-top:14px;"><div class="freetext-label">CCTV &amp; Surveillance</div><div class="view-kv">${kv('Coverage', b.cctv.coverage === 'yes' ? 'Yes' : b.cctv.coverage === 'no' ? 'No' : '')}${kv('Monitored Live', b.cctv.monitored === 'yes' ? 'Yes' : b.cctv.monitored === 'no' ? 'No' : '')}</div>${isContentValue(b.cctv.notes) ? `<div style="margin-top:8px;"><div class="freetext-label">Camera Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(b.cctv.notes)}</div></div>` : ''}</div>` : ''}
      ${(ac.backstageControlled === 'yes' || ac.backstageControlled === 'no') ? `<div style="margin-top:12px;" class="view-kv">${kv('Green Room / Backstage Access-Controlled', ac.backstageControlled === 'yes' ? 'Yes' : 'No')}</div>` : ''}
      ${isContentValue(ac.castCrewAccess) ? `<div style="margin-top:12px;"><div class="freetext-label">Cast &amp; Crew Access</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ac.castCrewAccess)}</div></div>` : ''}
      ${isContentValue(ac.teamArrival) ? `<div style="margin-top:12px;"><div class="freetext-label" style="color:var(--gold);">GenX Arrival — Door / Meet / Time</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ac.teamArrival)}</div></div>` : ''}
      ${isContentValue(ac.additionalCredentials) ? `<div style="margin-top:12px;"><div class="freetext-label">Additional Credentials (Venue-Stated)</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ac.additionalCredentials)}</div></div>` : ''}
      ${isContentValue(ac.parkingNotes) ? `<div style="margin-top:12px;"><div class="freetext-label">Parking Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(ac.parkingNotes)}</div></div>` : ''}`)}

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
          ${isContentValue(li.loadinNotes) ? `<div style="margin-top:8px;"><div class="freetext-label">Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(li.loadinNotes)}</div></div>` : ''}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-3);margin-bottom:6px;">Load Out</div>
          <div class="view-kv">
            ${kv('Date', li.loadoutDate ? formatDate(li.loadoutDate) : '')}
            ${kv('Time', li.loadoutTime ? formatTime(li.loadoutTime) : '')}
            ${kv('Vehicles', li.vehicleCount)}
          </div>
          ${isContentValue(li.loadoutNotes) ? `<div style="margin-top:8px;"><div class="freetext-label">Notes</div><div class="freetext-body" style="white-space:pre-wrap;line-height:1.6;">${esc(li.loadoutNotes)}</div></div>` : ''}
        </div>
      </div>`)}

    <!-- Run of Show (single or multi-day) -->
    ${(() => {
      const days = rosNormalizeDays(b.runofshow || []).filter(d => d.rows.length);
      if (!days.length) return '';
      const dayTable = d => `
        ${days.length > 1 ? `<div class="ros-day-label" style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--red);margin:14px 0 6px;">${esc(d.label)}</div>` : ''}
        <div style="overflow-x:auto;">
          <table class="ros-table ros-view">
            <thead><tr><th style="width:14%;">Time</th><th style="width:43%;">Activity</th><th style="width:43%;">Security Notes</th></tr></thead>
            <tbody>
              ${d.rows.map(r => `
                <tr class="${r.critical ? 'ros-row-critical' : ''}">
                  <td style="font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap;">${esc(r.time ? formatTime(r.time) : r.time)}</td>
                  <td style="font-weight:${r.critical ? '700' : '500'};">${esc(r.activity)}</td>
                  <td style="color:var(--text-2);">${esc(r.notes)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      return viewPanel('📋', 'Run of Show', days.map(dayTable).join(''), 'ros-panel');
    })()}

    <!-- Talent -->
    ${(b.talent || []).length ? viewPanel('🎤', 'Talent', `
      <div class="person-grid">
        ${(b.talent || []).map(p => {
          const showStage = p.stageName && p.stageName.trim().toLowerCase() !== (p.name || '').trim().toLowerCase();
          return `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="" style="object-position:${esc(p.photoPosition || '50% 5%')};">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            ${showStage ? `<div class="person-stage">${esc(p.stageName)}</div>` : ''}
            <div class="person-role">${esc(p.role)}</div>
            ${p.notes ? `<div class="person-notes" style="margin-top:8px;white-space:pre-wrap;">${esc(p.notes)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`, 'people-panel') : ''}

    <!-- Crew -->
    ${(b.crew || []).length ? viewPanel('🎬', 'Crew & Production', `
      <div class="person-grid">
        ${(b.crew || []).map(p => `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="" style="object-position:${esc(p.photoPosition || '50% 5%')};">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            <div class="person-role">${esc(p.function)}</div>
            ${p.phone ? `<div class="person-stage" style="font-style:normal;">${esc(p.phone)}</div>` : ''}
            ${p.notes ? `<div class="person-notes" style="margin-top:8px;">${esc(p.notes)}</div>` : ''}
          </div>`).join('')}
      </div>`, 'people-panel') : ''}

    <!-- GenX Security Staff -->
    ${(b.genxstaff || []).length ? viewPanel('🛡️', 'GenX Security Staff', `
      <div class="person-grid">
        ${(b.genxstaff || []).map(p => `
          <div class="person-card">
            <div class="person-photo" style="margin:0 auto 12px;cursor:default;">
              ${p.photo ? `<img src="${esc(p.photo)}" alt="" style="object-position:${esc(p.photoPosition || '50% 5%')};">` : `<span>${esc(getInitials(p.name))}</span>`}
            </div>
            <div class="person-name">${esc(p.name)}</div>
            <div class="person-role">${esc(p.role)}</div>
            ${p.phone ? `<div class="person-stage" style="font-style:normal;">${esc(p.phone)}</div>` : ''}
            ${p.email ? `<div class="person-stage" style="font-style:normal;font-size:11px;">${esc(p.email)}</div>` : ''}
            ${(p.certs || []).filter(Boolean).length ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px;">${(p.certs || []).filter(Boolean).map(c => `<span class="tag tag-red" style="font-size:9px;">${esc(c)}</span>`).join('')}</div>` : ''}
          </div>`).join('')}
      </div>`, 'people-panel') : ''}

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
          <div class="map-card" style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
            <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
              <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(m.title)}</div>
              ${m.description ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(m.description)}</div>` : ''}
            </div>
            <img src="${esc(m.image)}" alt="${esc(m.title)}" style="display:block;width:100%;height:auto;object-fit:contain;max-height:600px;background:#000;">
          </div>`).join('')}
      </div>`, 'maps-panel')
      : (b.noMapsProvided
          ? viewPanel('\u{1F5FA}\uFE0F', 'Venue Maps &amp; Diagrams',
              `<div style="font-size:14px;font-weight:600;color:var(--text-2);font-style:italic;">No maps provided to security team</div>`,
              'maps-panel')
          : '')}

    <div class="brief-endmark" style="text-align:center;padding:32px 0 16px;color:var(--text-3);font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">
      — GenX Security Brief System — Confidential Document —
    </div>
    <!-- Print-only trailing slack so the last page can't be cut. See
         .brief-print-tail in style.css for why this is height and not a break. -->
    <div class="brief-print-tail no-screen" aria-hidden="true"></div>
  `;
}

// ── View helpers ──────────────────────────────────────────────────────────────

function viewPanel(icon, title, content, extraClass = '') {
  return `
    <div class="view-panel${extraClass ? ' ' + extraClass : ''}">
      <div class="view-panel-header">
        <span class="section-icon" style="font-size:16px;">${icon}</span>
        <h3>${esc(title)}</h3>
      </div>
      <div class="view-panel-body">${content}</div>
    </div>`;
}

// Treat "None" / "N/A" / dashes as missing content so the brief view doesn't
// render them as if they were real entries (e.g. red callouts or blue chips).
function isContentValue(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (s === 'none' || s === 'n/a' || s === 'na' || s === '—' || s === '-' || s === 'tbd') return false;
  return true;
}

function kv(key, value) {
  if (!isContentValue(value)) return '';
  return `<div class="view-key">${esc(key)}</div><div class="view-val">${esc(String(value))}</div>`;
}

// The class names matter: the print stylesheet targets .mini-stat* to restyle
// these tiles for paper. The inline styles stay for the screen view; the print
// rules are !important so they still win.
function miniStat(label, value, sub) {
  return `
    <div class="mini-stat" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
      <div class="mini-stat-val" style="font-size:13px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums;">${esc(String(value))}</div>
      <div class="mini-stat-lbl" style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;margin-top:3px;">${esc(label)}</div>
      ${sub ? `<div class="mini-stat-sub" style="font-size:11px;color:var(--text-2);margin-top:2px;">${esc(sub)}</div>` : ''}
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
