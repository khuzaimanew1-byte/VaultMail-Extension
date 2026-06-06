'use strict';

// ── State ─────────────────────────────────────────────────────

let emails            = [];
let previewStatus     = 'activated'; // 'activated' | 'processing' | 'active'
let currentFieldEmail = null;
let capturedEmail     = null;        // last successfully submitted email (persisted, 2hr TTL)
let replitActive      = false;       // true when at least one Replit tab is open
let activeTab         = 'emails';
let pendingDelete     = null;

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — must match content.js

// ── DOM refs ──────────────────────────────────────────────────

const btnAdd           = document.getElementById('btnAdd');
const btnClose         = document.getElementById('btnClose');
const btnSave          = document.getElementById('btnSave');
const btnEmptyCta      = document.getElementById('btnEmptyCta');
const btnDeleteCancel  = document.getElementById('btnDeleteCancel');
const btnDeleteConfirm = document.getElementById('btnDeleteConfirm');

const modalOverlay  = document.getElementById('modalOverlay');
const deleteOverlay = document.getElementById('deleteOverlay');
const emailInput    = document.getElementById('emailInput');
const emailGrid     = document.getElementById('emailGrid');
const emptyState    = document.getElementById('emptyState');
const statsRow      = document.getElementById('statsRow');
const statCount     = document.getElementById('statCount');
const toast         = document.getElementById('toast');

const segmented    = document.getElementById('segmented');
const segIndicator = document.getElementById('segIndicator');
const segDot       = document.getElementById('segDot');
const tabEmails    = document.getElementById('tabEmails');
const tabPreview   = document.getElementById('tabPreview');
const panelEmails  = document.getElementById('panelEmails');
const panelPreview = document.getElementById('panelPreview');

// Preview panel
const pvStatusCard = document.getElementById('pvStatusCard');
const pvDot        = document.getElementById('pvDot');
const pvTitle      = document.getElementById('pvTitle');
const pvDesc       = document.getElementById('pvDesc');

const detectCount = document.getElementById('detectCount');
const detectList  = document.getElementById('detectList');
const detectEmpty = document.getElementById('detectEmpty');

// ── Storage ───────────────────────────────────────────────────

function loadState(cb) {
  chrome.storage.local.get(
    ['vaultmail_emails', 'capturedEmail', 'capturedEmailTs',
     'previewStatus', 'previewStatusTs', 'currentFieldEmail', 'detectedSelectors'],
    (r) => {
      const now = Date.now();

      // TTL check: expire capturedEmail if older than 2 hours
      const capturedExpired = r.capturedEmailTs && (now - r.capturedEmailTs) > TTL_MS;
      capturedEmail     = capturedExpired ? null : (r.capturedEmail || null);

      emails            = r.vaultmail_emails  || [];
      previewStatus     = r.previewStatus     || 'activated';
      currentFieldEmail = r.currentFieldEmail || null;
      cb(r.detectedSelectors || []);
    }
  );
}

function saveEmails(cb) {
  chrome.storage.local.set({ vaultmail_emails: emails }, cb);
}

// ── Parsing ───────────────────────────────────────────────────

function parseEmails(raw) {
  return [...new Set(
    raw.split(/[\n,]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  )];
}

// ── Segmented control ─────────────────────────────────────────

function positionIndicator(btn) {
  const cRect = segmented.getBoundingClientRect();
  const bRect = btn.getBoundingClientRect();
  segIndicator.style.left  = (bRect.left - cRect.left - 2) + 'px';
  segIndicator.style.width = bRect.width + 'px';
}

function switchTab(tab, instant = false) {
  activeTab = tab;
  tabEmails.classList.toggle('active', tab === 'emails');
  tabPreview.classList.toggle('active', tab === 'preview');
  panelEmails.style.display  = tab === 'emails'  ? 'block' : 'none';
  panelPreview.style.display = tab === 'preview' ? 'block' : 'none';
  const btn = tab === 'emails' ? tabEmails : tabPreview;
  if (instant) {
    const prev = segIndicator.style.transition;
    segIndicator.style.transition = 'none';
    requestAnimationFrame(() => {
      positionIndicator(btn);
      requestAnimationFrame(() => { segIndicator.style.transition = prev; });
    });
  } else {
    requestAnimationFrame(() => positionIndicator(btn));
  }
}

// ── Preview rendering ─────────────────────────────────────────

const STATUS_CONFIG = {
  activated: {
    title:     'Extension Activated',
    desc:      'Waiting for email interaction',
    dot:       'dot-activated',
    cardClass: '',
  },
  processing: {
    title:     'Processing',
    desc:      'Email detected. Preparing capture.',
    dot:       'dot-processing',
    cardClass: 'pv-status-card--processing',
  },
  active: {
    title:     'Previewing Account',
    dot:       'dot-active',
    cardClass: 'pv-status-card--active',
  },
};

function renderPreview() {
  // When no Replit tab is open, show Idle state regardless of previewStatus
  const displayStatus = (!replitActive && previewStatus !== 'active') ? 'activated' : previewStatus;

  const cfg = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.activated;

  pvTitle.textContent = cfg.title;
  pvDesc.textContent  = displayStatus === 'active' ? (capturedEmail || '') : cfg.desc;

  pvDot.className        = 'pv-dot ' + cfg.dot;
  pvStatusCard.className = 'pv-status-card ' + cfg.cardClass;

  // Seg dot
  segDot.className = 'seg-dot';
  if      (displayStatus === 'processing') segDot.classList.add('dot-processing');
  else if (displayStatus === 'active')     segDot.classList.add('dot-active');
  else                                     segDot.classList.add('dot-activated');
}

// ── Selector detection cards ──────────────────────────────────

function renderDetected(selectors) {
  if (!detectCount || !detectList || !detectEmpty) return;
  detectCount.textContent = selectors.length;
  [...detectList.querySelectorAll('.detect-card')].forEach(c => c.remove());
  if (!selectors.length) { detectEmpty.style.display = 'block'; return; }
  detectEmpty.style.display = 'none';
  selectors.forEach(s => {
    const card = document.createElement('div');
    card.className = 'detect-card detect-card--' + s.kind;
    const icon = s.kind === 'input'
      ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="2" width="8" height="6.5" rx="1.3" stroke="currentColor" stroke-width="1.1"/><path d="M1 3.5L5 6.2L9 3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`
      : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M3.5 5H6.5M5 3.5V6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`;
    const parts = [];
    if (s.id)   parts.push(`id="${s.id}"`);
    if (s.name) parts.push(`name="${s.name}"`);
    if (s.type && s.type !== 'text') parts.push(`type="${s.type}"`);
    if (s.aria) parts.push(`aria-label="${s.aria}"`);
    if (s.text && !s.aria && s.kind === 'button') parts.push(`"${s.text}"`);
    const detail = parts.join('  ·  ') || s.tagName;
    card.innerHTML = `
      <div class="dc-icon dc-icon--${s.kind}">${icon}</div>
      <div class="dc-body">
        <p class="dc-sel">${s.sel}</p>
        <p class="dc-detail">${detail}</p>
      </div>
      <div class="dc-badge dc-badge--${s.kind}">${s.kind === 'input' ? 'INPUT' : 'BTN'}</div>`;
    detectList.appendChild(card);
  });
}

// ── Email grid ────────────────────────────────────────────────

function renderGrid() {
  const has = emails.length > 0;
  emptyState.style.display = has ? 'none' : 'flex';
  emailGrid.style.display  = has ? 'grid' : 'none';
  statsRow.style.display   = has ? 'block' : 'none';
  if (!has) return;
  statCount.textContent = emails.length;
  emailGrid.innerHTML   = '';
  emails.forEach((email, i) => emailGrid.appendChild(createCard(email, i)));
}

function createCard(email, index) {
  const card = document.createElement('div');
  card.className = 'email-card';
  card.style.animationDelay = `${index * 20}ms`;
  card.innerHTML = `
    <div class="card-icon">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <rect x="1" y="2" width="8" height="6.5" rx="1.3" stroke="currentColor" stroke-width="1.1"/>
        <path d="M1 3.5L5 6.2L9 3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="card-email" title="${email}">${email}</span>
    <div class="card-actions">
      <button class="btn-icon btn-copy" aria-label="Copy">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="3" y="1" width="6" height="7" rx="1.2" stroke="currentColor" stroke-width="1.1"/>
          <path d="M2 3H1.8A1 1 0 0 0 .7 4V8.2C.7 8.8 1.1 9.2 1.7 9.2H5.9C6.5 9.2 6.9 8.8 6.9 8.2V8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-icon btn-delete" aria-label="Delete">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 2.5H9M3 2.5V1.8C3 1.4 3.4 1 3.8 1H6.2C6.6 1 7 1.4 7 1.8V2.5M4 4.5V7.5M6 4.5V7.5M2 2.5L2.5 8.2C2.5 8.6 2.8 9 3.2 9H6.8C7.2 9 7.5 8.6 7.5 8.2L8 2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;
  card.querySelector('.btn-copy').addEventListener('click', e => { e.stopPropagation(); copyText(email, 'Copied'); });
  card.querySelector('.btn-delete').addEventListener('click', e => { e.stopPropagation(); openDeleteModal(email); });
  return card;
}

// ── Clipboard ─────────────────────────────────────────────────

function copyText(text, msg) {
  const fallback = () => {
    const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast(msg);
  };
  navigator.clipboard ? navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(fallback) : fallback();
}

// ── Modals ────────────────────────────────────────────────────

function openAddModal()  { modalOverlay.classList.add('open'); emailInput.value = ''; setTimeout(() => emailInput.focus(), 180); }
function closeAddModal() { modalOverlay.classList.remove('open'); }

function handleSave() {
  const raw = emailInput.value.trim();
  if (!raw) return;
  const parsed = parseEmails(raw);
  if (!parsed.length) { showToast('No valid emails found'); return; }
  const before = emails.length;
  emails = [...new Set([...emails, ...parsed])];
  const added = emails.length - before;
  saveEmails(() => { closeAddModal(); renderGrid(); showToast(added === 0 ? 'Already saved' : `${added} email${added !== 1 ? 's' : ''} saved`); });
}

function openDeleteModal(email) { pendingDelete = email; deleteTarget.textContent = email; deleteOverlay.classList.add('open'); }
function closeDeleteModal()     { deleteOverlay.classList.remove('open'); pendingDelete = null; }

function confirmDelete() {
  if (!pendingDelete) return;
  const target = pendingDelete;
  closeDeleteModal();
  const card = [...emailGrid.querySelectorAll('.email-card')].find(c => c.querySelector('.card-email')?.title === target);
  const finish = () => { emails = emails.filter(e => e !== target); saveEmails(() => renderGrid()); };
  if (card) { card.classList.add('card-removing'); card.addEventListener('animationend', finish, { once: true }); }
  else finish();
}

const deleteTarget = document.getElementById('deleteTarget');

// ── Toast ─────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
}

// ── Runtime messages ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {

    case 'CONTEXT_LOCKED':
      previewStatus     = 'processing';
      currentFieldEmail = message.email || null;
      renderPreview();
      break;

    case 'CURRENT_EMAIL_CHANGED':
      currentFieldEmail = message.email || null;
      // Only re-render if we're in processing state
      if (previewStatus === 'processing') renderPreview();
      break;

    case 'EMAIL_CAPTURED':
      previewStatus     = 'active';
      capturedEmail     = message.email || null;
      currentFieldEmail = message.email || null;
      renderPreview();
      break;

    case 'CONTEXT_RESET':
      previewStatus     = 'activated';
      currentFieldEmail = null;
      renderPreview();
      break;

    case 'REPLIT_STATUS_CHANGED':
      replitActive = !!message.active;
      renderPreview();
      break;

    case 'SELECTORS_UPDATED':
      renderDetected(message.selectors || []);
      break;
  }
});

// ── Storage change listener ───────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  let changed = false;
  if ('capturedEmail'     in changes) {
    // Apply TTL: if new value has expired, treat as null
    const newVal = changes.capturedEmail.newValue || null;
    capturedEmail = newVal;
    changed = true;
  }
  if ('previewStatus'     in changes) { previewStatus     = changes.previewStatus.newValue     || 'activated'; changed = true; }
  if ('currentFieldEmail' in changes) { currentFieldEmail = changes.currentFieldEmail.newValue || null;        changed = true; }
  if ('detectedSelectors' in changes) { renderDetected(changes.detectedSelectors.newValue || []); }
  if (changed) renderPreview();
});

// ── Events ────────────────────────────────────────────────────

btnAdd.addEventListener('click', openAddModal);
btnEmptyCta.addEventListener('click', openAddModal);
btnClose.addEventListener('click', closeAddModal);
btnSave.addEventListener('click', handleSave);
btnDeleteCancel.addEventListener('click', closeDeleteModal);
btnDeleteConfirm.addEventListener('click', confirmDelete);
tabEmails.addEventListener('click',  () => switchTab('emails'));
tabPreview.addEventListener('click', () => switchTab('preview'));
modalOverlay.addEventListener('click',  e => { if (e.target === modalOverlay)  closeAddModal(); });
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (deleteOverlay.classList.contains('open')) closeDeleteModal();
    else if (modalOverlay.classList.contains('open')) closeAddModal();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && modalOverlay.classList.contains('open')) handleSave();
});

// ── Init ──────────────────────────────────────────────────────

loadState((detectedSelectors) => {
  switchTab('emails', true);
  renderGrid();
  renderPreview();
  renderDetected(detectedSelectors);
});
