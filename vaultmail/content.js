'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first
//   - No continuous DOM scanning for capture
//   - Activates when user interacts with an email field
//   - Locks context (email + form + submit button) on first touch
//   - Sends status updates: CONTEXT_LOCKED, CURRENT_EMAIL_CHANGED,
//     EMAIL_CAPTURED, CONTEXT_RESET
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

function isPasswordToggle(btn) {
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  return label.includes('show password') || label.includes('hide password');
}

function findSubmitInForm(form) {
  if (!form) return null;
  const candidates = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  for (const btn of candidates) {
    if (!isPasswordToggle(btn)) return btn;
  }
  return null;
}

// ── Live field value tracking ─────────────────────────────────

function onFieldInput() {
  if (!activeEmailInput) return;
  const val = activeEmailInput.value.trim();
  chrome.storage.local.set({ currentFieldEmail: val });
  send('CURRENT_EMAIL_CHANGED', { email: val });
}

// ── Re-resolve context if DOM was re-rendered ─────────────────

function ensureContextValid() {
  if (!activeEmailInput || !document.contains(activeEmailInput)) {
    resetContext();
    return false;
  }
  if (!activeSubmitBtn || !document.contains(activeSubmitBtn)) {
    activeForm      = activeEmailInput.form || activeEmailInput.closest('form');
    activeSubmitBtn = findSubmitInForm(activeForm);
    if (!activeSubmitBtn) return false;
    attachSubmitListeners();
  }
  return true;
}

// ── Email capture ─────────────────────────────────────────────

function onSubmitClicked() {
  if (!ensureContextValid()) return;
  const val = activeEmailInput.value.trim().toLowerCase();
  if (!val) return;
  chrome.storage.local.set({
    capturedEmail:     val,
    currentFieldEmail: val,
    previewStatus:     'active',
  }, () => {
    send('EMAIL_CAPTURED', { email: val });
  });
}

// ── Attach listeners to current activeSubmitBtn ───────────────

function attachSubmitListeners() {
  if (!activeSubmitBtn) return;
  activeSubmitBtn.addEventListener('mousedown', onSubmitClicked, { capture: true });
  activeSubmitBtn.addEventListener('click',     onSubmitClicked, { capture: true });
}

// ── Lock context on first email input interaction ─────────────

function lockContext(emailInput) {
  if (contextLocked && activeEmailInput === emailInput) return;

  // Different email field — replace context
  contextLocked    = false;
  activeEmailInput = emailInput;
  activeForm       = emailInput.form || emailInput.closest('form');
  activeSubmitBtn  = findSubmitInForm(activeForm);
  contextLocked    = true;

  const initialVal = emailInput.value.trim();

  chrome.storage.local.set({
    previewStatus:    'processing',
    currentFieldEmail: initialVal,
  }, () => {
    send('CONTEXT_LOCKED', { email: initialVal });
  });

  if (activeSubmitBtn) attachSubmitListeners();

  emailInput.addEventListener('input', onFieldInput);
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmitClicked();
  });

  if (activeForm) {
    activeForm.addEventListener('submit', onSubmitClicked, { capture: true });
  }
}

// ── Reset context (called on navigation) ─────────────────────

function resetContext() {
  activeEmailInput = null;
  activeForm       = null;
  activeSubmitBtn  = null;
  contextLocked    = false;

  chrome.storage.local.set({
    previewStatus:    'activated',
    currentFieldEmail: null,
  }, () => {
    send('CONTEXT_RESET');
  });
}

// ── Interaction listener ──────────────────────────────────────

function onEmailInteraction(e) {
  const target = e.target;
  if (!target || target.tagName !== 'INPUT') return;

  for (const sel of EMAIL_INPUT_SELS) {
    try {
      if (target.matches(sel)) {
        // If already locked to a DIFFERENT input, switch context
        if (contextLocked && activeEmailInput !== target) {
          contextLocked = false;
        }
        lockContext(target);
        return;
      }
    } catch (_) {}
  }
}

document.addEventListener('focusin', onEmailInteraction, { capture: true });
document.addEventListener('input',   onEmailInteraction, { capture: true });

// ── SPA navigation ────────────────────────────────────────────

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

// ── Selector detection (for Detected Elements panel only) ─────

const PROBE_SELECTORS = [
  { sel: 'input[name="identifier"]',         kind: 'input',  label: 'identifier' },
  { sel: 'input[name="email"]',              kind: 'input',  label: 'name=email' },
  { sel: 'input[name="username"]',           kind: 'input',  label: 'name=username' },
  { sel: 'input[type="email"]',              kind: 'input',  label: 'type=email' },
  { sel: 'input[autocomplete="email"]',      kind: 'input',  label: 'autocomplete=email' },
  { sel: 'input[autocomplete="username"]',   kind: 'input',  label: 'autocomplete=username' },
  { sel: 'input[placeholder*="email" i]',    kind: 'input',  label: 'placeholder~email' },
  { sel: 'input[placeholder*="username" i]', kind: 'input',  label: 'placeholder~username' },
  { sel: '[id^="username-"]',               kind: 'input',  label: 'id^=username-' },
  { sel: '[id^="email-"]',                  kind: 'input',  label: 'id^=email-' },
  { sel: 'button[type="submit"]',            kind: 'button', label: 'submit button' },
  { sel: 'input[type="submit"]',             kind: 'button', label: 'input[submit]' },
  { sel: '[id^="react-aria"]',              kind: 'button', label: 'id^=react-aria' },
  { sel: 'button[aria-label*="continue" i]', kind: 'button', label: 'aria~continue' },
  { sel: 'button[aria-label*="next" i]',     kind: 'button', label: 'aria~next' },
  { sel: 'button[aria-label*="sign" i]',     kind: 'button', label: 'aria~sign' },
];

let scanThrottle = null;

function scanSelectors() {
  const found = [];
  for (const probe of PROBE_SELECTORS) {
    try {
      const els = [...document.querySelectorAll(probe.sel)];
      for (const el of els) {
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
