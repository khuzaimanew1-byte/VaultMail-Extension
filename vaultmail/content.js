'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first, document-level event delegation
//
// CONTEXT ENGINE v3 — spec rules:
//   - ONLY user interaction creates context (input/change events)
//   - focusin / mousedown do NOT create context and do NOT capture
//   - event.target is the sole source of truth — no .contains(), no closest()
//   - Submit captured via click (strict target match) and form submit (Enter key)
//   - Single-capture guard prevents duplicate capture per submission
//   - Status-based 5-minute cleanup timers (not fixed TTL)
//   - Active status never expires; cleanup starts only when status goes inactive
//   - vaultmail_emails is permanent — never touched here
// ============================================================

// ── Email selectors ───────────────────────────────────────────

const EMAIL_SELS = [
  'input[autocomplete="email"]',
  'input[name="email"]',
  'input[name="username"]',
];

// ── Constants ─────────────────────────────────────────────────

const CLEANUP_MS = 5 * 60 * 1000; // 5 minutes — cleanup delay after status goes inactive

// ── Active context (in-memory only) ──────────────────────────
//
// Created only by input/change events on a valid email field.
// Replaced entirely on each new valid interaction.

let activeContext      = null; // { emailInput, emailValue, lastUpdated }
let activeSubmitButton = null;
let activeForm         = null;

// ── Status tracking (for cleanup timer management) ───────────

let currentStatus = 'activated'; // mirrors last written previewStatus

// ── Cleanup timers (status-based, not time-based TTL) ────────
//
// Each timer starts when its status goes inactive.
// Each timer is cancelled if the same status becomes active again.
// Only statuses inactive for the full 5 minutes are cleaned up.

let processingCleanupTimer = null;
let previewCleanupTimer    = null;

function scheduleProcessingCleanup() {
  clearTimeout(processingCleanupTimer);
  processingCleanupTimer = setTimeout(() => {
    processingCleanupTimer = null;
    chrome.storage.local.set({ currentFieldEmail: null });
  }, CLEANUP_MS);
}

function cancelProcessingCleanup() {
  clearTimeout(processingCleanupTimer);
  processingCleanupTimer = null;
}

function schedulePreviewCleanup() {
  clearTimeout(previewCleanupTimer);
  previewCleanupTimer = setTimeout(() => {
    previewCleanupTimer = null;
    chrome.storage.local.set({
      capturedEmail: null,
      previewStatus: 'activated',
    }, () => { send('CONTEXT_RESET'); });
  }, CLEANUP_MS);
}

function cancelPreviewCleanup() {
  clearTimeout(previewCleanupTimer);
  previewCleanupTimer = null;
}

// ── Status transition handler ─────────────────────────────────
//
// Called after every previewStatus storage write.
// Manages cleanup timers based on which statuses become active/inactive.

function onStatusChange(newStatus) {
  const prev = currentStatus;
  currentStatus = newStatus;

  // Processing became inactive → start its cleanup timer
  if (prev === 'processing' && newStatus !== 'processing') scheduleProcessingCleanup();
  // Processing became active → cancel any pending cleanup
  if (newStatus === 'processing') cancelProcessingCleanup();

  // Preview became inactive → start its cleanup timer
  if (prev === 'active' && newStatus !== 'active') schedulePreviewCleanup();
  // Preview became active → cancel any pending cleanup
  if (newStatus === 'active') cancelPreviewCleanup();
}

// ── Single-capture debounce ───────────────────────────────────
//
// Prevents duplicate capture when both click and form submit
// fire within the same user action (e.g. button click → form submit).

let lastCaptureTime = 0;

// ── Helpers ───────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function isPasswordToggle(btn) {
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  return label.includes('show password') || label.includes('hide password');
}

function findSubmitInForm(form) {
  if (!form) return null;
  for (const btn of form.querySelectorAll('button[type="submit"], input[type="submit"]')) {
    if (!isPasswordToggle(btn)) return btn;
  }
  return null;
}

// ── Context creation ──────────────────────────────────────────
//
// Called ONLY from input/change event handlers.
// Discards previous context and builds a new one.
// If form or submit button missing → clear to activated.

function updateContext(emailInput) {
  const emailValue = emailInput.value.trim();
  const form       = emailInput.form || emailInput.closest('form');
  const submitBtn  = findSubmitInForm(form);

  if (!form || !submitBtn) {
    clearContext();
    return;
  }

  activeContext      = { emailInput, emailValue, lastUpdated: Date.now() };
  activeForm         = form;
  activeSubmitButton = submitBtn;

  chrome.storage.local.set({
    previewStatus:     'processing',
    currentFieldEmail: emailValue,
  }, () => {
    send('CONTEXT_LOCKED', { email: emailValue });
    onStatusChange('processing');
  });
}

// ── Context clear ─────────────────────────────────────────────

function clearContext() {
  activeContext      = null;
  activeSubmitButton = null;
  activeForm         = null;

  chrome.storage.local.set({
    previewStatus:     'activated',
    currentFieldEmail: null,
  }, () => {
    send('CONTEXT_RESET');
    onStatusChange('activated');
  });
}

// ── Email capture ─────────────────────────────────────────────
//
// Only this function writes capturedEmail.
// Processing state never writes capturedEmail.
// Single-capture guard prevents duplicate writes per submission.

function captureEmail() {
  if (!activeContext) return;

  // Prevent duplicate capture from simultaneous click + form submit events
  const now = Date.now();
  if (now - lastCaptureTime < 500) return;
  lastCaptureTime = now;

  const val = activeContext.emailInput.value.trim().toLowerCase();
  if (!val) return;

  chrome.storage.local.set({
    capturedEmail: val,
    previewStatus: 'active',
  }, () => {
    send('EMAIL_CAPTURED', { email: val });
    onStatusChange('active');
  });
}

// ── Email interaction handler ─────────────────────────────────
//
// Triggered ONLY by input and change events.
// focusin is NOT listened to — focus alone does not create context.
// Only event.target is evaluated. No parent traversal. No DOM scan.

function onEmailEvent(e) {
  const target = e.target;
  if (!target || target.tagName !== 'INPUT') return;

  let matched = false;
  for (const sel of EMAIL_SELS) {
    try { if (target.matches(sel)) { matched = true; break; } } catch (_) {}
  }
  if (!matched) return;

  updateContext(target);
}

document.addEventListener('input',  onEmailEvent, { capture: true });
document.addEventListener('change', onEmailEvent, { capture: true });

// ── Submit button click ───────────────────────────────────────
//
// Document-level delegation. Strict event.target match only.
// No .contains(). No parent traversal. No mousedown.
// If event.target is not exactly activeSubmitButton → return immediately.

document.addEventListener('click', (e) => {
  if (!activeContext || !activeSubmitButton) return;
  if (e.target !== activeSubmitButton) return;
  captureEmail();
}, { capture: true });

// ── Form submit (Enter key path) ──────────────────────────────
//
// When user presses Enter in the email field, the browser fires a
// native submit event on the parent form. This listener captures it.
// No separate keydown listener — Enter key is handled via form submit only.
// Single-capture guard prevents double capture if click also fires submit.

document.addEventListener('submit', (e) => {
  if (!activeContext || !activeForm) return;
  if (e.target !== activeForm) return;
  captureEmail();
}, { capture: true });

// ── SPA navigation ────────────────────────────────────────────

function onNavigate() { clearContext(); }

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onNavigate, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onNavigate, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onNavigate, 80));

// ── Selector detection (display-only panel — NOT used for capture) ────
//
// MutationObserver here is ONLY for the Detected Elements UI panel.
// It has no connection to context creation or capture logic.

const PROBE_SELECTORS = [
  { sel: 'input[name="identifier"]',         kind: 'input',  label: 'identifier' },
  { sel: 'input[name="email"]',              kind: 'input',  label: 'name=email' },
  { sel: 'input[name="username"]',           kind: 'input',  label: 'name=username' },
  { sel: 'input[type="email"]',              kind: 'input',  label: 'type=email' },
  { sel: 'input[autocomplete="email"]',      kind: 'input',  label: 'autocomplete=email' },
  { sel: 'input[autocomplete="username"]',   kind: 'input',  label: 'autocomplete=username' },
  { sel: 'input[placeholder*="email" i]',    kind: 'input',  label: 'placeholder~email' },
  { sel: 'input[placeholder*="username" i]', kind: 'input',  label: 'placeholder~username' },
  { sel: '[id^="username-"]',                kind: 'input',  label: 'id^=username-' },
  { sel: '[id^="email-"]',                   kind: 'input',  label: 'id^=email-' },
  { sel: 'button[type="submit"]',            kind: 'button', label: 'submit button' },
  { sel: 'input[type="submit"]',             kind: 'button', label: 'input[submit]' },
  { sel: '[id^="react-aria"]',               kind: 'button', label: 'id^=react-aria' },
  { sel: 'button[aria-label*="continue" i]', kind: 'button', label: 'aria~continue' },
  { sel: 'button[aria-label*="next" i]',     kind: 'button', label: 'aria~next' },
  { sel: 'button[aria-label*="sign" i]',     kind: 'button', label: 'aria~sign' },
];

let scanThrottle = null;

function scanSelectors() {
  const found = [];
  for (const probe of PROBE_SELECTORS) {
    try {
      for (const el of document.querySelectorAll(probe.sel)) {
        found.push({
          sel:     probe.sel,
          label:   probe.label,
          kind:    probe.kind,
          tagName: el.tagName,
          id:      el.id   || '',
          name:    el.name || '',
          type:    el.type || '',
          aria:    el.getAttribute('aria-label') || '',
          text:    el.textContent.trim().slice(0, 40),
        });
      }
    } catch (_) {}
  }
  chrome.storage.local.set({ detectedSelectors: found }, () => {
    send('SELECTORS_UPDATED', { selectors: found });
  });
}

function scheduleScan() {
  clearTimeout(scanThrottle);
  scanThrottle = setTimeout(scanSelectors, 200);
}

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scanSelectors();
setTimeout(scanSelectors, 1000);
setTimeout(scanSelectors, 3000);

// ── Init ──────────────────────────────────────────────────────

chrome.storage.local.set({ previewStatus: 'activated', currentFieldEmail: null });
send('CONTEXT_RESET');
