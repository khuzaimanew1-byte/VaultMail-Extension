'use strict';

let emails             = [];
let currentActiveEmail = null;
let captureStatus      = 'activated';
let activeTab          = 'emails';
let pendingDelete      = null;

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
const previewSub       = document.getElementById('previewSub');
const deleteTarget     = document.getElementById('deleteTarget');

const stateActivated   = document.getElementById('stateActivated');
const stateProcessing  = document.getElementById('stateProcessing');
const stateActive      = document.getElementById('stateActive');

// ── Debug panel elements ───────────────────────────────────────

const dbgTagName        = document.getElementById('dbgTagName');
const dbgDetectedTarget = document.getElementById('dbgDetectedTarget');
const dbgEmailCandidate = document.getElementById('dbgEmailCandidate');
const dbgFormFound      = document.getElementById('dbgFormFound');
const dbgSubmitFound    = document.getElementById('dbgSubmitFound');
const dbgCurrentStatus  = document.getElementById('dbgCurrentStatus');
const dbgActiveSelector = document.getElementById('dbgActiveSelector');

const archInteraction   = document.getElementById('archInteraction');
const archDomScan       = document.getElementById('archDomScan');
const archMutObs        = document.getElementById('archMutObs');
const archInterval      = document.getElementById('archInterval');
const archContext       = document.getElementById('archContext');

// ── Storage ───────────────────────────────────────────────────

function loadState(cb) {
  chrome.storage.local.get(
    ['vaultmail_emails', 'currentActiveEmail', 'captureStatus', 'vmDebug', 'vmArch'],
    (r) => {
      emails             = r.vaultmail_emails   || [];
      currentActiveEmail = r.currentActiveEmail || null;
      captureStatus      = r.captureStatus      || 'activated';
      cb(r.vmDebug || null, r.vmArch || null);
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

// ── Preview state ─────────────────────────────────────────────

function renderPreview() {
  const isActivated  = captureStatus === 'activated';
  const isProcessing = captureStatus === 'processing';
  const isPreviewing = captureStatus === 'previewing';

  stateActivated.style.display  = isActivated  ? 'flex' : 'none';
  stateProcessing.style.display = isProcessing ? 'flex' : 'none';
  stateActive.style.display     = isPreviewing ? 'flex' : 'none';

  if (isPreviewing && currentActiveEmail) {
    previewEmail.textContent     = currentActiveEmail;
    previewEmail.style.display   = 'block';
    previewSub.style.display     = 'none';
    btnCopyPreview.style.display = 'flex';
  } else {
    previewEmail.style.display   = 'none';
    previewSub.style.display     = 'block';
    btnCopyPreview.style.display = 'none';
  }

  segDot.className = 'seg-dot';
  if      (isProcessing) segDot.classList.add('dot-processing');
  else if (isPreviewing) segDot.classList.add('dot-active');
  else                   segDot.classList.add('dot-activated');
}

// ── Testing panel ─────────────────────────────────────────────

function yn(val) {
  if (val === null || val === undefined || val === '—') return '—';
  return val ? 'YES' : 'NO';
}

function activeInactive(val) {
  return val ? 'ACTIVE' : 'INACTIVE';
}

function yesNo(val) {
  return val ? 'YES' : 'NO';
}

function applyClass(el, val) {
  el.className = 'test-val';
  if (val === 'YES' || val === 'ACTIVE' || val === 'NO' && el === archDomScan || val === 'NO' && el === archMutObs || val === 'NO' && el === archInterval) {
    el.classList.add(val === 'YES' || val === 'ACTIVE' ? 'val-yes' : 'val-no');
  } else if (val === 'NO') {
    el.classList.add('val-no');
  } else if (val === 'INACTIVE') {
    el.classList.add('val-inactive');
  }
  if (el === dbgActiveSelector) el.classList.add('test-val--mono');
}

function renderDebug(d) {
  if (!d) return;

  const fields = {
    [dbgTagName]:        d.tagName        || '—',
    [dbgDetectedTarget]: yn(d.detectedTarget),
    [dbgEmailCandidate]: yn(d.emailCandidate),
    [dbgFormFound]:      yn(d.formFound),
    [dbgSubmitFound]:    yn(d.submitFound),
    [dbgCurrentStatus]:  d.currentStatus  || '—',
    [dbgActiveSelector]: d.activeSelector || '—',
  };

  for (const [el, val] of Object.entries(fields)) {
    el.textContent = val;
    applyClass(el, val);
  }

  archContext.textContent = d.contextLocked ? 'ACTIVE' : 'INACTIVE';
  applyClass(archContext, d.contextLocked ? 'ACTIVE' : 'INACTIVE');
}

function renderArch(a) {
  if (!a) return;
  archInteraction.textContent = activeInactive(a.interactionListener);
  applyClass(archInteraction, a.interactionListener ? 'ACTIVE' : 'INACTIVE');
  archDomScan.textContent = yesNo(a.continuousDomScan);
  applyClass(archDomScan, a.continuousDomScan ? 'YES' : 'NO');
  archMutObs.textContent = yesNo(a.mutationObserver);
  applyClass(archMutObs, a.mutationObserver ? 'YES' : 'NO');
  archInterval.textContent = yesNo(a.intervalScanner);
  applyClass(archInterval, a.intervalScanner ? 'YES' : 'NO');
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
          <path d="M1 2.5H9M3 2.5V1.8C3 1.4 3.4 1 3.8 1H6.2C6.6 1 7 1.4 7 1.8V2.5M4 4.5V7.5M6 4.5V7.5M2 2.5L2.5 8.2C2.5 8.6 2.8 9 3 9H7C7.2 9 7.5 8.6 7.5 8.2L8 2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
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

function openAddModal() { modalOverlay.classList.add('open'); emailInput.value = ''; setTimeout(() => emailInput.focus(), 180); }
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
function closeDeleteModal() { deleteOverlay.classList.remove('open'); pendingDelete = null; }

function confirmDelete() {
  if (!pendingDelete) return;
  const target = pendingDelete;
  closeDeleteModal();
  const card = [...emailGrid.querySelectorAll('.email-card')].find(c => c.querySelector('.card-email')?.title === target);
  const finish = () => { emails = emails.filter(e => e !== target); saveEmails(() => renderGrid()); };
  if (card) { card.classList.add('card-removing'); card.addEventListener('animationend', finish, { once: true }); }
  else finish();
}

// ── Toast ─────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2100);
}

// ── Messages ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_CHANGED') {
    captureStatus = message.status || 'activated';
    if (captureStatus === 'activated') currentActiveEmail = null;
    renderPreview();
  }
  if (message.type === 'ACTIVE_EMAIL_UPDATED') {
    currentActiveEmail = message.email || null;
    renderPreview();
  }
  if (message.type === 'DEBUG_UPDATED') {
    renderDebug(message.debug);
  }
});

chrome.storage.onChanged.addListener((changes) => {
  let previewChanged = false;
  if ('captureStatus'      in changes) { captureStatus      = changes.captureStatus.newValue      || 'activated'; previewChanged = true; }
  if ('currentActiveEmail' in changes) { currentActiveEmail = changes.currentActiveEmail.newValue || null;        previewChanged = true; }
  if (previewChanged) renderPreview();
  if ('vmDebug' in changes) renderDebug(changes.vmDebug.newValue);
  if ('vmArch'  in changes) renderArch(changes.vmArch.newValue);
});

// ── Events ────────────────────────────────────────────────────

btnAdd.addEventListener('click', openAddModal);
btnEmptyCta.addEventListener('click', openAddModal);
btnClose.addEventListener('click', closeAddModal);
btnSave.addEventListener('click', handleSave);
btnCopyPreview.addEventListener('click', () => { if (currentActiveEmail) copyText(currentActiveEmail, 'Copied'); });
btnDeleteCancel.addEventListener('click', closeDeleteModal);
btnDeleteConfirm.addEventListener('click', confirmDelete);
tabEmails.addEventListener('click',  () => switchTab('emails'));
tabPreview.addEventListener('click', () => switchTab('preview'));
modalOverlay.addEventListener('click',  e => { if (e.target === modalOverlay)  closeAddModal(); });
deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) closeDeleteModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (deleteOverlay.classList.contains('open')) closeDeleteModal(); else if (modalOverlay.classList.contains('open')) closeAddModal(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && modalOverlay.classList.contains('open')) handleSave();
});

// ── Init ──────────────────────────────────────────────────────

loadState((debug, arch) => {
  switchTab('emails', true);
  renderGrid();
  renderPreview();
  if (debug) renderDebug(debug);
  if (arch)  renderArch(arch);
});
