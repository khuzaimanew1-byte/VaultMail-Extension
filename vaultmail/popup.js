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

function getDomain(email) {
  return email.split('@')[1] || '';
}

// ============================================================
// RENDERING
// ============================================================

function renderGrid() {
  const hasEmails = emails.length > 0;

  emptyState.style.display  = hasEmails ? 'none'  : 'flex';
  emailGrid.style.display   = hasEmails ? 'grid'  : 'none';
  statsRow.style.display    = hasEmails ? 'flex'  : 'none';

  if (!hasEmails) return;

  statCount.textContent = emails.length;
  emailGrid.innerHTML   = '';

  emails.forEach((email, index) => {
    const card = createCard(email, index);
    emailGrid.appendChild(card);
  });
}

function createCard(email, index) {
  const domain = getDomain(email);
  const card   = document.createElement('div');
  card.className = 'email-card';
  card.style.animationDelay = `${index * 28}ms`;

  card.innerHTML = `
    <div class="card-icon">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M1 4.5L6 7.5L11 4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </div>
    <span class="card-email" title="${email}">${email}</span>
    <span class="card-domain">${domain}</span>
    <div class="card-actions">
      <button class="btn-icon btn-copy" data-email="${email}" aria-label="Copy" title="Copy">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect x="3.5" y="1" width="6.5" height="7.5" rx="1.3" stroke="currentColor" stroke-width="1.2"/>
          <path d="M2.5 3.5H2A1.2 1.2 0 0 0 .8 4.7V9.5C.8 10.1 1.3 10.5 2 10.5H6.5C7.1 10.5 7.5 10 7.5 9.5V9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-icon btn-delete" data-email="${email}" aria-label="Delete" title="Delete">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M1.5 3H9.5M3.5 3V2C3.5 1.7 3.7 1.5 4 1.5H7C7.3 1.5 7.5 1.7 7.5 2V3M4.5 5V8.5M6.5 5V8.5M2.5 3L3 9C3 9.3 3.3 9.5 3.6 9.5H7.4C7.7 9.5 8 9.3 8 9L8.5 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
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
  setTimeout(() => emailInput.focus(), 200);
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
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
