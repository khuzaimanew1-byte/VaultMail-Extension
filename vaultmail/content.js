'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Two independent jobs:
//   1. DETECT — scan every known selector, report which ones
//      exist in the DOM right now → stored as detectedSelectors[]
//   2. CAPTURE — when an email input + nearby button are found,
//      attach click handler, save email immediately on click.
// ============================================================

// ── All selectors to probe independently ─────────────────────

const PROBE_SELECTORS = [
  // Email-like inputs
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
  // Buttons / submits
  { sel: 'button[type="submit"]',            kind: 'button', label: 'submit button' },
  { sel: 'input[type="submit"]',             kind: 'button', label: 'input[submit]' },
  { sel: '[id^="react-aria"]',              kind: 'button', label: 'id^=react-aria' },
  { sel: 'button[aria-label*="continue" i]', kind: 'button', label: 'aria~continue' },
  { sel: 'button[aria-label*="next" i]',     kind: 'button', label: 'aria~next' },
  { sel: 'button[aria-label*="sign" i]',     kind: 'button', label: 'aria~sign' },
];

// ── State ─────────────────────────────────────────────────────

let captureAttached = false;
let scanThrottle    = null;

// ── Helpers ───────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

// ── Job 1: detect all selectors in DOM ───────────────────────

function scanSelectors() {
  const found = [];

  for (const probe of PROBE_SELECTORS) {
    try {
      const els = [...document.querySelectorAll(probe.sel)];
      for (const el of els) {
        found.push({
          sel:      probe.sel,
          label:    probe.label,
          kind:     probe.kind,
          tagName:  el.tagName,
          id:       el.id       || '',
          name:     el.name     || '',
          type:     el.type     || '',
          aria:     el.getAttribute('aria-label') || '',
          text:     el.textContent.trim().slice(0, 40),
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
  scanThrottle = setTimeout(scanSelectors, 120);
}

// ── Job 2: capture email on button click ──────────────────────

function findEmailInput() {
  const EMAIL_SELS = [
    'input[name="identifier"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
    '[id^="username-"]',
    '[id^="email-"]',
  ];
  for (const sel of EMAIL_SELS) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

function findSubmitBtn(emailInput) {
  // Include react-aria buttons — Replit uses these as submit buttons
  const BTN_SELS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[aria-label*="continue" i]',
    'button[aria-label*="next" i]',
    'button[aria-label*="sign" i]',
    '[id^="react-aria"]',
    'button',
  ];

  // Search inside same form first
  const form = emailInput?.closest('form');
  if (form) {
    for (const sel of BTN_SELS) {
      const el = form.querySelector(sel);
      if (el) return el;
    }
  }

  // Walk up container tree — increased depth to 12 for deeply nested React UIs
  let node = emailInput?.parentElement;
  for (let d = 0; d < 12 && node; d++) {
    for (const sel of BTN_SELS) {
      try {
        const el = node.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    node = node.parentElement;
  }

  // Last resort: find first visible button anywhere on the page
  try {
    const allBtns = [...document.querySelectorAll('button, [role="button"]')];
    return allBtns.find(b => b.offsetParent !== null) || null;
  } catch (_) {}

  return null;
}

function saveEmail(email) {
  if (!email) return;
  chrome.storage.local.set({ currentActiveEmail: email }, () => {
    send('ACTIVE_EMAIL_UPDATED', { email });
  });
}

function tryAttachCapture() {
  if (captureAttached) return;

  const emailInput = findEmailInput();
  if (!emailInput) return;

  const submitBtn = findSubmitBtn(emailInput);

  // Only mark as attached when BOTH are found so we don't block future retries
  if (!submitBtn) return;

  captureAttached = true;

  const grab = () => {
    const val = emailInput.value.trim().toLowerCase();
    if (val) saveEmail(val);
  };

  submitBtn.addEventListener('mousedown', grab, { capture: true });
  submitBtn.addEventListener('click',     grab, { capture: true });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') grab();
  });

  const form = emailInput.closest('form');
  if (form) form.addEventListener('submit', grab, { capture: true });
}

// ── MutationObserver: re-run both jobs on DOM changes ─────────

const observer = new MutationObserver(() => {
  scheduleScan();
  tryAttachCapture();
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// ── SPA navigation ────────────────────────────────────────────

function onNavigate() {
  captureAttached = false;
  scheduleScan();
  setTimeout(tryAttachCapture, 400);
}

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onNavigate, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onNavigate, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onNavigate, 80));

// ── Init ──────────────────────────────────────────────────────

scanSelectors();
tryAttachCapture();

// Re-scan after React renders
setTimeout(() => { scanSelectors(); tryAttachCapture(); }, 800);
setTimeout(() => { scanSelectors(); tryAttachCapture(); }, 2000);
setTimeout(() => { scanSelectors(); tryAttachCapture(); }, 4000);
