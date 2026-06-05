'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Strategy: 4 independent selector pairs.
// When EITHER email input OR submit button in a pair is found,
// we register listeners for that pair.
// On button click → immediately save currentActiveEmail.
// No redirect waiting. No URL matching. No /~ required.
// ============================================================

const PAIRS = [
  {
    name:     'Pair 1',
    emailSel: '[id="username-:rv:"]',
    btnSel:   '[id="react-aria1080582148-:r1c:"]',
  },
  {
    name:     'Pair 2',
    emailSel: '[id="email-:r1o:"]',
    btnSel:   '[id="react-aria8519681457-:r25:"]',
  },
  {
    name:     'Pair 3',
    emailSel: '[id="username-:r0:"]',
    btnSel:   '[id="react-aria2175002955-:rd:"]',
  },
  {
    name:     'Pair 4',
    emailSel: '[id="email-:r1b:"]',
    btnSel:   '[id="react-aria2637049068-:r1o:"]',
  },
];

// Track which pairs already have click handlers so we don't double-attach
const attachedPairs = new Set();

// ── Helpers ───────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function log(...args) {
  console.log('[VaultMail]', ...args);
}

// ── Save email immediately ────────────────────────────────────

function saveEmail(email, pairName) {
  if (!email) return;
  log('Email captured from', pairName, '→', email);

  chrome.storage.local.set({ currentActiveEmail: email }, () => {
    log('Email saved to storage:', email);
    send('ACTIVE_EMAIL_UPDATED', { email });
    log('Preview updated');
  });
}

// ── Attach listeners for one pair ─────────────────────────────

function attachPair(pair) {
  if (attachedPairs.has(pair.name)) return true; // already done

  const emailInput = document.querySelector(pair.emailSel);
  const submitBtn  = document.querySelector(pair.btnSel);

  if (!emailInput || !submitBtn) return false; // not found yet

  log(pair.name, 'detected — attaching listeners');

  // On every click of the submit button: capture current value immediately
  submitBtn.addEventListener('click', () => {
    const email = emailInput.value.trim().toLowerCase();
    log(pair.name, 'button clicked — email value:', email || '(empty)');
    if (email) saveEmail(email, pair.name);
  }, { capture: true });

  // Also capture on mousedown so we get the value before any blur event
  submitBtn.addEventListener('mousedown', () => {
    const email = emailInput.value.trim().toLowerCase();
    if (email) {
      // Pre-save; the click handler will confirm
      chrome.storage.local.set({ pendingEmail: email });
      log(pair.name, 'mousedown pre-save:', email);
    }
  }, { capture: true });

  // Keyboard: Enter on the input field
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const email = emailInput.value.trim().toLowerCase();
      log(pair.name, 'Enter pressed — email:', email || '(empty)');
      if (email) saveEmail(email, pair.name);
    }
  });

  // Track the form submit event too
  const form = emailInput.closest('form');
  if (form) {
    form.addEventListener('submit', () => {
      const email = emailInput.value.trim().toLowerCase();
      log(pair.name, 'form submit — email:', email || '(empty)');
      if (email) saveEmail(email, pair.name);
    }, { capture: true });
  }

  attachedPairs.add(pair.name);
  log(pair.name, 'listeners attached successfully');
  return true;
}

// ── Scan all pairs ────────────────────────────────────────────

function scanPairs() {
  for (const pair of PAIRS) {
    attachPair(pair);
  }
}

// ── MutationObserver — re-scan on DOM changes ─────────────────
// Replit is a React SPA: elements appear asynchronously.
// Scan every time the DOM changes until all pairs are attached.

const observer = new MutationObserver(() => {
  scanPairs();

  // If all pairs are attached, disconnect (saves CPU)
  if (attachedPairs.size === PAIRS.length) {
    log('All pairs attached — disconnecting observer');
    observer.disconnect();
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree:   true,
});

// ── Init ──────────────────────────────────────────────────────

log('Content script loaded on', window.location.href);
scanPairs(); // immediate check on load
