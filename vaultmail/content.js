'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first, document-level event delegation
//
// CONTEXT ENGINE v2 — spec rules:
//   - ONLY user interaction creates context (input/change events)
//   - focusin alone does NOT create context
//   - event.target is the only source of truth
//   - No DOM scanning, no MutationObserver for context
//   - Submit detected via document-level click delegation
//   - 2-hour TTL on all temporary state
//   - vaultmail_emails is permanent — never touched here
// ============================================================

// ── Constants ─────────────────────────────────────────────────

const EMAIL_SELS = [
  'input[autocomplete="email"]',
  'input[name="email"]',
  'input[name="username"]',
];

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// ── Active context (in-memory only) ──────────────────────────
//
// activeContext = { emailInput, emailValue, lastUpdated }
//   - Created only by input/change events on valid email fields
//   - Discarded and rebuilt on every new valid interaction
//   - Never created by DOM presence, URL, or focusin

let activeContext      = null;
let activeSubmitButton = null;
let activeForm         = null;

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
// Immediately discards any previous context and builds a new one.
// If form or submit button is missing → clear to activated.

function updateContext(emailInput) {
  const emailValue = emailInput.value.trim();

  // Resolve form and submit button from the interacted element only
  const form      = emailInput.form || emailInput.closest('form');
  const submitBtn = findSubmitInForm(form);

  // All three required; if any missing → no context, return to activated
  if (!form || !submitBtn) {
    clearContext();
    return;
  }

  // Discard previous context; build new one
  activeContext      = { emailInput, emailValue, lastUpdated: Date.now() };
  activeForm         = form;
  activeSubmitButton = submitBtn;

  const ts = Date.now();
  chrome.storage.local.set({
    previewStatus:     'processing',
    previewStatusTs:   ts,
    currentFieldEmail: emailValue,
  }, () => {
    send('CONTEXT_LOCKED', { email: emailValue });
  });
}

// ── Context clear ─────────────────────────────────────────────

function clearContext() {
  activeContext      = null;
  activeSubmitButton = null;
  activeForm         = null;

  const ts = Date.now();
  chrome.storage.local.set({
    previewStatus:     'activated',
    previewStatusTs:   ts,
    currentFieldEmail: null,
  }, () => {
    send('CONTEXT_RESET');
  });
}

// ── Email capture ─────────────────────────────────────────────
//
// Only a successful capture may update capturedEmail.
// Processing state never overwrites capturedEmail.

function captureEmail() {
  if (!activeContext) return;

  // Always read live value from DOM at capture time
  const val = activeContext.emailInput.value.trim().toLowerCase();
  if (!val) return;

  const ts = Date.now();
  chrome.storage.local.set({
    capturedEmail:   val,
    capturedEmailTs: ts,
    previewStatus:   'active',
    previewStatusTs: ts,
  }, () => {
    send('EMAIL_CAPTURED', { email: val });
  });
}

// ── Email interaction handler ─────────────────────────────────
//
// Triggered ONLY by input and change events.
// focusin does NOT create context — focus alone is ignored.
// Only event.target is evaluated — no other element inspected.

function onEmailEvent(e) {
  const target = e.target;
  if (!target || target.tagName !== 'INPUT') return;

  // Check only e.target against valid selectors — stop if no match
  let matched = false;
  for (const sel of EMAIL_SELS) {
    try { if (target.matches(sel)) { matched = true; break; } } catch (_) {}
  }
  if (!matched) return;

  // Match — update context from this element
  updateContext(target);
}

document.addEventListener('input',  onEmailEvent, { capture: true });
document.addEventListener('change', onEmailEvent, { capture: true });

// ── Submit detection (document-level click delegation) ────────
//
// Listen at document level. Use event.target to identify the click target.
// Only act if the clicked element is the tracked activeSubmitButton.
// Also accepts clicks on child elements inside the button (e.g. inner <span>).

document.addEventListener('click', (e) => {
  if (!activeContext || !activeSubmitButton) return;
  const t = e.target;
  if (t !== activeSubmitButton && !activeSubmitButton.contains(t)) return;
  captureEmail();
}, { capture: true });

// mousedown supplement — catches React-intercepted submits that stop click propagation
document.addEventListener('mousedown', (e) => {
  if (!activeContext || !activeSubmitButton) return;
  const t = e.target;
  if (t !== activeSubmitButton && !activeSubmitButton.contains(t)) return;
  captureEmail();
}, { capture: true });

// Enter key on the active email input
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !activeContext) return;
  if (e.target !== activeContext.emailInput) return;
  captureEmail();
}, { capture: true });

// Form submit event (final safety net)
document.addEventListener('submit', (e) => {
  if (!activeContext || !activeForm) return;
  if (e.target !== activeForm && !activeForm.contains(e.target)) return;
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

// ── TTL check (on content script load) ───────────────────────
//
// If temporary state is older than 2 hours, expire it.
// vaultmail_emails is NEVER touched — permanent storage.

function checkTTL() {
  chrome.storage.local.get(['capturedEmailTs', 'previewStatusTs'], (r) => {
    const now     = Date.now();
    const updates = {};

    if (r.capturedEmailTs && (now - r.capturedEmailTs) > TTL_MS) {
      updates.capturedEmail    = null;
      updates.capturedEmailTs  = null;
    }

    // Always reset previewStatus to activated on fresh page load
    updates.previewStatus   = 'activated';
    updates.previewStatusTs = now;
    updates.currentFieldEmail = null;

    chrome.storage.local.set(updates, () => {
      send('CONTEXT_RESET');
    });
  });
}

// ── Selector detection (display-only panel — NOT used for capture) ────
//
// MutationObserver here is ONLY for the Detected Elements UI panel.
// It does NOT create context. It does NOT affect capture logic.

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

// ── Init ──────────────────────────────────────────────────────

checkTTL();
