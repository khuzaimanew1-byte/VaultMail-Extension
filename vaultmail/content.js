'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first
//   - Activates only when user touches an email input
//   - Locks context (email input + form + submit button)
//   - Broadcasts 3-state status: activated → processing → previewing
//   - No continuous DOM scanning, no expensive observers
// ============================================================

// ── Email input candidates ────────────────────────────────────

const EMAIL_INPUT_SELS = [
  'input[autocomplete="email"]',
  'input[name="email"]',
  'input[name="username"]',
];

// ── Locked capture context ────────────────────────────────────

let activeEmailInput = null;
let activeForm       = null;
let activeSubmitBtn  = null;
let contextLocked    = false;

// ── Helpers ───────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function saveEmail(email) {
  if (!email) return;
  chrome.storage.local.set({ currentActiveEmail: email }, () => {
    send('ACTIVE_EMAIL_UPDATED', { email });
  });
}

function setStatus(status) {
  chrome.storage.local.set({ captureStatus: status });
  send('STATUS_CHANGED', { status });
}

function isPasswordToggle(btn) {
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  return label.includes('show password') || label.includes('hide password');
}

// Find submit button strictly inside the given form.
// Only button[type="submit"] or input[type="submit"]. Never type="button".
function findSubmitInForm(form) {
  if (!form) return null;
  const candidates = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  for (const btn of candidates) {
    if (!isPasswordToggle(btn)) return btn;
  }
  return null;
}

// ── Submit button click handler ───────────────────────────────

function onSubmitClicked() {
  if (!activeEmailInput || !document.contains(activeEmailInput)) {
    resetContext();
    return;
  }
  const val = activeEmailInput.value.trim().toLowerCase();
  if (val) saveEmail(val);
}

// ── Attach listeners to activeSubmitBtn ───────────────────────

function attachSubmitListener() {
  if (!activeSubmitBtn) return;
  activeSubmitBtn.addEventListener('mousedown', onSubmitClicked, { capture: true });
  activeSubmitBtn.addEventListener('click',     onSubmitClicked, { capture: true });
}

// ── Try to upgrade from processing → previewing ───────────────

function tryUpgradeToPreview() {
  if (!activeEmailInput || !document.contains(activeEmailInput)) {
    resetContext();
    return;
  }
  activeForm      = activeEmailInput.form || activeEmailInput.closest('form');
  activeSubmitBtn = findSubmitInForm(activeForm);
  if (activeSubmitBtn) {
    attachSubmitListener();
    setStatus('previewing');
  }
}

// ── Re-verify context hasn't been destroyed by React rerender ─

function ensureContextValid() {
  if (!activeEmailInput || !document.contains(activeEmailInput)) {
    resetContext();
    return;
  }
  if (!activeSubmitBtn || !document.contains(activeSubmitBtn)) {
    activeForm      = activeEmailInput.form || activeEmailInput.closest('form');
    activeSubmitBtn = findSubmitInForm(activeForm);
    if (activeSubmitBtn) {
      attachSubmitListener();
    }
  }
}

// ── Lock context on first email input interaction ─────────────

function lockContext(emailInput) {
  setStatus('processing');

  contextLocked    = true;
  activeEmailInput = emailInput;
  activeForm       = emailInput.form || emailInput.closest('form');
  activeSubmitBtn  = findSubmitInForm(activeForm);

  if (activeSubmitBtn) {
    attachSubmitListener();
    setStatus('previewing');
  }

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmitClicked();
  });

  if (activeForm) {
    activeForm.addEventListener('submit', onSubmitClicked, { capture: true });
  }
}

// ── Reset all context (navigation or context lost) ────────────

function resetContext() {
  activeEmailInput = null;
  activeForm       = null;
  activeSubmitBtn  = null;
  contextLocked    = false;
  setStatus('activated');
}

// ── Delegated interaction listener ───────────────────────────
// Responds only to focus/input on valid email input candidates.

function onEmailInteraction(e) {
  const target = e.target;
  if (!target || target.tagName !== 'INPUT') return;

  let isEmailCandidate = false;
  for (const sel of EMAIL_INPUT_SELS) {
    try { if (target.matches(sel)) { isEmailCandidate = true; break; } } catch (_) {}
  }
  if (!isEmailCandidate) return;

  if (contextLocked) {
    if (target !== activeEmailInput) {
      // User moved to a different email field — reset and re-lock
      resetContext();
      lockContext(target);
    } else if (!activeSubmitBtn) {
      // Same field but still in processing — try to find submit button
      tryUpgradeToPreview();
    } else {
      // Normal interaction on locked context — verify DOM still valid
      ensureContextValid();
    }
    return;
  }

  lockContext(target);
}

document.addEventListener('focusin', onEmailInteraction, { capture: true });
document.addEventListener('input',   onEmailInteraction, { capture: true });

// ── SPA navigation — full context reset on route change ───────

function onNavigate() {
  resetContext();
}

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onNavigate, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onNavigate, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onNavigate, 80));

// ── Init: broadcast default status on script load ─────────────

setStatus('activated');
