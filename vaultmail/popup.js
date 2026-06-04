'use strict';

// ============================================================
// STATE
// ============================================================

let emails             = [];
let currentActiveEmail = null;
let replitActive       = false;
let activeTab          = 'emails';
let pendingDelete      = null;

// ============================================================
// DOM REFS
// ============================================================

const btnAdd           = document.getElementById('btnAdd');
const btnClose         = document.getElementById('btnClose');
const btnSave          = document.getElementById('btnSave');
const btnEmptyCta      = document.getElementById('btnEmptyCta');
const btnCopyPreview   = document.getElementById('btnCopyPreview');
const btnDeleteCancel  = document.getElementById('btnDeleteCancel');
const btnDeleteConfirm = document.getElementById('btnDeleteConfirm');

const modalOverlay     = document.getElementById('modalOverlay');
const deleteOverlay    = document.getElementById('deleteOverlay');
const emailInput       = document.getElementById('emailInput');
const emailGrid        = document.getElementById('emailGrid');
const emptyState       = document.getElementById('emptyState');
const statsRow         = document.getElementById('statsRow');
const statCount        = document.getElementById('statCount');
const toast            = document.getElementById('toast');

const segmented        = document.getElementById('segmented');
const segIndicator     = document.getElementById('segIndicator');
const segDot           = document.getElementById('segDot');
const tabEmails        = document.getElementById('tabEmails');
const tabPreview       = document.getElementById('tabPreview');
const panelEmails      = document.getElementById('panelEmails');
const panelPreview     = document.getElementById('panelPreview');
const previewEmail     = document.getElementById('previewEmail');
const deleteTarget     = document.getElementById('deleteTarget');

// Preview state cards
const stateIdle        = document.getElementById('stateIdle');
const stateActivated   = document.getElementById('stateActivated');
const stateActive      = document.getElementById('stateActive');

// ============================================================
// STORAGE
// ============================================================

function loadState(callback) {
  chrome.storage.local.get(
    ['vaultmail_emails', 'currentActiveEmail', 'replitActive'],
    (result) => {
      emails             = result.vaultmail_emails   || [];
      currentActiveEmail = result.currentActiveEmail || null;
      replitActive       = result.replitActive       || false;
      callback();
    }
  );
}

function saveEmails(cb) {
  chrome.storage.local.set({ vaultmail_emails: emails }, cb);
}

// ============================================================
// PARSING
// ============================================================

function parseEmails(raw) {
  return [...new Set(
    raw.split(/[\n,]+/)
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && isValidEmail(e))
  )];
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ============================================================
// SEGMENTED CONTROL — pill indicator
// ============================================================

function positionIndicator(btn) {
  const cRect = segmented.getBoundingClientRect();
  const bRect = btn.getBoundingClientRect();
  segIndicator.style.left  = (bRect.left - cRect.left - 2) + 'px';
  segIndicator.style.width = bRect.width + 'px';
}

// ============================================================
// TAB SWITCHING
// ============================================================

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

// ============================================================
// PREVIEW PANEL — 3 status states
// ============================================================

/**
 * Determine which state to show:
 *   active    → currentActiveEmail set
 *   activated → replitActive is true, no email yet
 *   idle      → no Replit tab
 */
function currentPreviewState() {
  if (currentActiveEmail) return 'active';
  if (replitActive)       return 'activated';
  return 'idle';
}

function renderPreview() {
  const state = currentPreviewState();

  stateIdle.style.display      = state === 'idle'      ? 'flex' : 'none';
  stateActivated.style.display = state === 'activated' ? 'flex' : 'none';
  stateActive.style.display    = state === 'active'    ? 'flex' : 'none';

  if (state === 'active') {
    previewEmail.textContent = currentActiveEmail;
  }

  // Update dot in the tab button
  segDot.className = 'seg-dot';
  if (state === 'activated') segDot.classList.add('dot-activated');
  else if (state === 'active') segDot.classList.add('dot-active');
  else segDot.classList.add('dot-idle');
}

// ============================================================
// RENDERING — EMAIL GRID
// ============================================================

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

  card.querySelector('.btn-copy').addEventListener('click', e => {
    e.stopPropagation();
    copyText(email, 'Copied');
  });
  card.querySelector('.btn-delete').addEventListener('click', e => {
    e.stopPropagation();
    openDeleteModal(email);
  });

  return card;
}

// ============================================================
// CLIPBOARD
// ============================================================

function copyText(text, msg) {
  const fallback = () => {
    const ta = Object.assign(document.createElement('textarea'), {
      value: text, style: 'position:fixed;opacity:0'
    });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(msg);
  };
  navigator.clipboard
    ? navigator.clipboard.writeText(text).then(() => showToast(msg)).catch(fallback)
    : fallback();
}

// ============================================================
// ADD MODAL
// ============================================================

function openAddModal() {
  modalOverlay.classList.add('open');
  emailInput.value = '';
  setTimeout(() => emailInput.focus(), 180);
}

function closeAddModal() { modalOverlay.classList.remove('open'); }

function handleSave() {
  const raw    = emailInput.value.trim();
  if (!raw) return;
  const parsed = parseEmails(raw);
  if (!parsed.length) { showToast('No valid emails found'); return; }

  const before = emails.length;
  emails = [...new Set([...emails, ...parsed])];
  const added = emails.length - before;

  saveEmails(() => {
    closeAddModal();
    renderGrid();
    showToast(added === 0 ? 'Already saved' : `${added} email${added !== 1 ? 's' : ''} saved`);
  });
}

// ============================================================
// DELETE MODAL
// ============================================================

function openDeleteModal(email) {
  pendingDelete = email;
  deleteTarget.textContent = email;
  deleteOverlay.classList.add('open');
}

function closeDeleteModal() {
  deleteOverlay.classList.remove('open');
  pendingDelete = null;
}

function confirmDelete() {
  if (!pendingDelete) return;
  const target = pendingDelete;
  closeDeleteModal();

  const card = [...emailGrid.querySelectorAll('.email-card')]
    .find(c => c.querySelector('.card-email')?.title === target);

  const finish = () => {
    emails = emails.filter(e => e !== target);
    saveEmails(() => renderGrid());
  };

  if (card) {
    card.classList.add('card-removing');
    card.addEventListener('animationend', finish, { once: true });
  } else {
    finish();
  }
}

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
}

// ============================================================
// RUNTIME MESSAGES
// ============================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ACTIVE_EMAIL_UPDATED' && message.email) {
    currentActiveEmail = message.email;
    renderPreview();
  }
  if (message.type === 'REPLIT_STATUS_CHANGED') {
    replitActive = message.active;
    renderPreview();
  }
  if (message.type === 'URL_CHANGED') {
    chrome.storage.local.get(['currentActiveEmail', 'replitActive'], (r) => {
      currentActiveEmail = r.currentActiveEmail || null;
      replitActive       = r.replitActive       || false;
      renderPreview();
    });
  }
});

// ============================================================
// EVENTS
// ============================================================

btnAdd.addEventListener('click', openAddModal);
btnEmptyCta.addEventListener('click', openAddModal);
btnClose.addEventListener('click', closeAddModal);
btnSave.addEventListener('click', handleSave);

btnCopyPreview.addEventListener('click', () => {
  if (currentActiveEmail) copyText(currentActiveEmail, 'Copied');
});

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

// ============================================================
// INIT
// ============================================================

loadState(() => {
  switchTab('emails', true);
  renderGrid();
  renderPreview();
});
