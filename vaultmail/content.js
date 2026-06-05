'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first
//   - No continuous DOM scanning
//   - No MutationObserver for capture logic
//   - Only activates when user interacts with an email input
//   - Locks context (email + form + submit button) on first touch
// ============================================================

// ── Email input candidates ────────────────────────────────────

const EMAIL_INPUT_SELS = [
  'input[autocomplete="email"]',
  'input[name="email"]',
  'input[name="username"]',
];

// ── Locked capture context ────────────────────────────────────

let activeEmailInput  = null;
let activeForm        = null;
let activeSubmitBtn   = null;
let contextLocked     = false;

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

function isPasswordToggle(btn) {
  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  return label.includes('show password') || label.includes('hide password');
}

// Find the submit button strictly inside the given form.
// Ignores type="button" and password-toggle buttons.
function findSubmitInForm(form) {
  if (!form) return null;
  const candidates = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  for (const btn of candidates) {
    if (!isPasswordToggle(btn)) return btn;
  }
  return null;
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
    attachSubmitListener();
  }
  return true;
}

// ── Submit button click handler ───────────────────────────────

function onSubmitClicked() {
  if (!ensureContextValid()) return;
  const val = activeEmailInput.value.trim().toLowerCase();
  if (val) saveEmail(val);
}

// ── Attach listener to current activeSubmitBtn ────────────────

function attachSubmitListener() {
  if (!activeSubmitBtn) return;
  activeSubmitBtn.addEventListener('mousedown', onSubmitClicked, { capture: true });
  activeSubmitBtn.addEventListener('click',     onSubmitClicked, { capture: true });
}

// ── Reset context (called on navigation) ─────────────────────

function resetContext() {
  activeEmailInput = null;
  activeForm       = null;
  activeSubmitBtn  = null;
  contextLocked    = false;
}

// ── Lock context on first email input interaction ─────────────

function lockContext(emailInput) {
  if (contextLocked) return;
  contextLocked    = true;
  activeEmailInput = emailInput;
  activeForm       = emailInput.form || emailInput.closest('form');
  activeSubmitBtn  = findSubmitInForm(activeForm);

  if (activeSubmitBtn) {
    attachSubmitListener();
  }

  // Also capture on Enter key inside the email field
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmitClicked();
  });

  // Also capture on form submit event
  if (activeForm) {
    activeForm.addEventListener('submit', onSubmitClicked, { capture: true });
  }
}

// ── Interaction listener ──────────────────────────────────────
// Delegated on document — catches focus/input on any email candidate
// without needing to scan the DOM upfront.

function onEmailInteraction(e) {
  if (contextLocked) {
    ensureContextValid();
    return;
  }
  const target = e.target;
  if (!target || target.tagName !== 'INPUT') return;

  for (const sel of EMAIL_INPUT_SELS) {
    try {
      if (target.matches(sel)) {
        lockContext(target);
        return;
      }
    } catch (_) {}
  }
}

document.addEventListener('focusin', onEmailInteraction, { capture: true });
document.addEventListener('input',   onEmailInteraction, { capture: true });

// ── SPA navigation — reset on route change ────────────────────

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

// ── Selector detection (UI display only, separate from capture) ──
// Lightweight scan used only to populate the "Detected Elements"
// panel in the popup. Does NOT drive capture logic.

const PROBE_SELECTORS = [
  { sel: 'input[name="identifier"]',         kind: 'input', label: 'identifier' },
  { sel: 'input[name="email"]',              kind: 'input', label: 'name=email' },
  { sel: 'input[name="username"]',           kind: 'input', label: 'name=username' },
  { sel: 'input[type="email"]',              kind: 'input', label: 'type=email' },
  { sel: 'input[autocomplete="email"]',      kind: 'input', label: 'autocomplete=email' },
  { sel: 'input[autocomplete="username"]',   kind: 'input', label: 'autocomplete=username' },
  { sel: 'input[placeholder*="email" i]',    kind: 'input', label: 'placeholder~email' },
  { sel: 'input[placeholder*="username" i]', kind: 'input', label: 'placeholder~username' },
  { sel: '[id^="username-"]',               kind: 'input', label: 'id^=username-' },
  { sel: '[id^="email-"]',                  kind: 'input', label: 'id^=email-' },
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
          id:      el.id    || '',
          name:    el.name  || '',
          type:    el.type  || '',
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

// MutationObserver only for the detection panel — not for capture
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Initial scan
scanSelectors();
setTimeout(scanSelectors, 1000);
setTimeout(scanSelectors, 3000);
