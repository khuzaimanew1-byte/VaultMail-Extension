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
const modalOverlay = document.getElementById('modalOverlay');
const emailInput   = document.getElementById('emailInput');
const emailList    = document.getElementById('emailList');
const emptyState   = document.getElementById('emptyState');
const toast        = document.getElementById('toast');

// ============================================================
// STORAGE
// ============================================================

function loadEmails() {
  chrome.storage.local.get(['vaultmail_emails'], (result) => {
    emails = result.vaultmail_emails || [];
    renderList();
  });
}

function saveEmails(callback) {
  chrome.storage.local.set({ vaultmail_emails: emails }, callback);
}

// ============================================================
// PARSING
// ============================================================

function parseEmails(raw) {
  const lines = raw.split(/[\n,]+/);
  const parsed = lines
    .map(e => e.trim().toLowerCase())
    .filter(e => e.length > 0 && isValidEmail(e));
  return [...new Set(parsed)];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// RENDERING
// ============================================================

function getInitial(email) {
  return email.charAt(0).toUpperCase();
}

function renderList() {
  const hasEmails = emails.length > 0;

  emptyState.style.display = hasEmails ? 'none' : 'flex';
  emailList.style.display  = hasEmails ? 'flex' : 'none';

  if (!hasEmails) return;

  // Build section header + cards
  emailList.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'section-header';
  header.innerHTML = `
    <span class="section-label">Saved</span>
    <span class="count-badge">${emails.length}</span>
  `;
  emailList.appendChild(header);

  emails.forEach((email, index) => {
    const card = createCard(email, index);
    emailList.appendChild(card);
  });
}

function createCard(email, index) {
  const card = document.createElement('div');
  card.className = 'email-card';
  card.dataset.index = index;

  card.innerHTML = `
    <div class="card-avatar">${getInitial(email)}</div>
    <span class="card-email" title="${email}">${email}</span>
    <div class="card-actions">
      <button class="btn-icon btn-copy" data-email="${email}" aria-label="Copy email" title="Copy">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4.5" y="1" width="7.5" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M3 4H2.5A1.5 1.5 0 0 0 1 5.5v5A1.5 1.5 0 0 0 2.5 12H8A1.5 1.5 0 0 0 9.5 10.5V10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-icon btn-delete" data-email="${email}" aria-label="Delete email" title="Delete">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3.5H11M4.5 3.5V2.5C4.5 2 5 1.5 5.5 1.5H7.5C8 1.5 8.5 2 8.5 2.5V3.5M5.5 6V9.5M7.5 6V9.5M3.5 3.5L4 10.5C4 11 4.5 11.5 5 11.5H8C8.5 11.5 9 11 9 10.5L9.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;

  // Staggered animation delay
  card.style.animationDelay = `${index * 35}ms`;
  card.style.opacity = '0';
  requestAnimationFrame(() => { card.style.opacity = ''; });

  // Copy button
  card.querySelector('.btn-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    copyEmail(email);
  });

  // Delete button
  card.querySelector('.btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteEmail(email, card);
  });

  return card;
}

// ============================================================
// ACTIONS
// ============================================================

function copyEmail(email) {
  navigator.clipboard.writeText(email).then(() => {
    showToast('Copied to clipboard');
  }).catch(() => {
    // Fallback for extensions context
    const ta = document.createElement('textarea');
    ta.value = email;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard');
  });
}

function deleteEmail(email, cardEl) {
  cardEl.classList.add('card-removing');
  cardEl.addEventListener('animationend', () => {
    emails = emails.filter(e => e !== email);
    saveEmails(() => renderList());
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

  // Merge — avoid duplicates with existing
  const before = emails.length;
  const merged = [...new Set([...emails, ...parsed])];
  const added  = merged.length - before;

  emails = merged;
  saveEmails(() => {
    closeModal();
    renderList();
    if (added === 0) {
      showToast('Already saved');
    } else {
      showToast(`${added} email${added !== 1 ? 's' : ''} saved`);
    }
  });
}

// ============================================================
// MODAL
// ============================================================

function openModal() {
  modalOverlay.classList.add('open');
  emailInput.value = '';
  // Focus after animation
  setTimeout(() => emailInput.focus(), 180);
}

function closeModal() {
  modalOverlay.classList.remove('open');
}

// ============================================================
// TOAST
// ============================================================

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

btnAdd.addEventListener('click', openModal);
btnClose.addEventListener('click', closeModal);
btnSave.addEventListener('click', handleSave);

// Close on overlay backdrop click
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
    closeModal();
  }
  if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) && modalOverlay.classList.contains('open')) {
    handleSave();
  }
});

// ============================================================
// INIT
// ============================================================

loadEmails();
