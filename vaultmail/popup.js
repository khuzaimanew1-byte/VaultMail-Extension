'use strict';

// ============================================================
// STATE
// ============================================================

let emails = [];

// ============================================================
// DOM REFS
// ============================================================

const btnAdd       = document.getElementById('btnAdd');
const btnClose     = document.getElementById('btnClose');
const btnSave      = document.getElementById('btnSave');
const btnEmptyCta  = document.getElementById('btnEmptyCta');
const modalOverlay = document.getElementById('modalOverlay');
const emailInput   = document.getElementById('emailInput');
const emailGrid    = document.getElementById('emailGrid');
const emptyState   = document.getElementById('emptyState');
const statsRow     = document.getElementById('statsRow');
const statCount    = document.getElementById('statCount');
const toast        = document.getElementById('toast');

// ============================================================
// STORAGE
// ============================================================

function loadEmails() {
  chrome.storage.local.get(['vaultmail_emails'], (result) => {
    emails = result.vaultmail_emails || [];
    renderGrid();
  });
}

function saveEmails(callback) {
  chrome.storage.local.set({ vaultmail_emails: emails }, callback);
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// RENDERING
// ============================================================

function renderGrid() {
  const hasEmails = emails.length > 0;

  emptyState.style.display = hasEmails ? 'none' : 'flex';
  emailGrid.style.display  = hasEmails ? 'grid' : 'none';
  statsRow.style.display   = hasEmails ? 'flex' : 'none';

  if (!hasEmails) return;

  statCount.textContent = emails.length;
  emailGrid.innerHTML   = '';

  emails.forEach((email, index) => {
    emailGrid.appendChild(createCard(email, index));
  });
}

function createCard(email, index) {
  const card = document.createElement('div');
  card.className = 'email-card';
  card.style.animationDelay = `${index * 25}ms`;

  card.innerHTML = `
    <div class="card-icon">
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="2" width="9" height="7" rx="1.4" stroke="currentColor" stroke-width="1.15"/>
        <path d="M1 4L5.5 6.8L10 4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="card-email" title="${email}">${email}</span>
    <div class="card-actions">
      <button class="btn-icon btn-copy" aria-label="Copy" title="Copy">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <rect x="3" y="1" width="6" height="7" rx="1.2" stroke="currentColor" stroke-width="1.15"/>
          <path d="M2 3H1.8A1.1 1.1 0 0 0 .7 4.1V8.3C.7 8.9 1.1 9.3 1.7 9.3H5.9C6.5 9.3 6.9 8.9 6.9 8.3V8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-icon btn-delete" aria-label="Delete" title="Delete">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 2.5H9M3 2.5V1.8C3 1.4 3.4 1 3.8 1H6.2C6.6 1 7 1.4 7 1.8V2.5M4 4.5V7.5M6 4.5V7.5M2 2.5L2.5 8.2C2.5 8.6 2.8 9 3.2 9H6.8C7.2 9 7.5 8.6 7.5 8.2L8 2.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;

  card.querySelector('.btn-copy').addEventListener('click', e => {
    e.stopPropagation();
    copyEmail(email);
  });

  card.querySelector('.btn-delete').addEventListener('click', e => {
    e.stopPropagation();
    deleteEmail(email, card);
  });

  return card;
}

// ============================================================
// ACTIONS
// ============================================================

function copyEmail(email) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = email;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).then(() => showToast('Copied')).catch(fallback);
  } else {
    fallback();
  }
}

function deleteEmail(email, cardEl) {
  cardEl.classList.add('card-removing');
  cardEl.addEventListener('animationend', () => {
    emails = emails.filter(e => e !== email);
    saveEmails(() => renderGrid());
  }, { once: true });
}

function handleSave() {
  const raw = emailInput.value.trim();
  if (!raw) return;

  const parsed = parseEmails(raw);
  if (parsed.length === 0) {
    showToast('No valid emails found');
    return;
  }

  const before = emails.length;
  emails = [...new Set([...emails, ...parsed])];
  const added = emails.length - before;

  saveEmails(() => {
    closeModal();
    renderGrid();
    showToast(added === 0 ? 'Already saved' : `${added} email${added !== 1 ? 's' : ''} saved`);
  });
}

// ============================================================
// MODAL
// ============================================================

function openModal() {
  modalOverlay.classList.add('open');
  emailInput.value = '';
  setTimeout(() => emailInput.focus(), 190);
}

function closeModal() {
  modalOverlay.classList.remove('open');
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
// EVENTS
// ============================================================

btnAdd.addEventListener('click', openModal);
btnEmptyCta.addEventListener('click', openModal);
btnClose.addEventListener('click', closeModal);
btnSave.addEventListener('click', handleSave);

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && modalOverlay.classList.contains('open')) handleSave();
});

// ============================================================
// INIT
// ============================================================

loadEmails();
