'use strict';

// ============================================================
// CONTENT SCRIPT — runs on https://replit.com/*
//
// States sent to background:
//   FORM_DETECTED    → login form is visible (→ Processing)
//   EMAIL_SUBMITTED  → user clicked submit / pressed Enter
//   LOGIN_SUCCESS    → page redirected to /~ after form submit
// ============================================================

const HOME_PATTERN = /^https:\/\/replit\.com\/(~|home|dashboard)/;

// Broaden selectors — Replit's React IDs change between builds.
// We try a cascade of increasing generality.
const EMAIL_SELECTORS = [
  // Specific Replit IDs (snapshot)
  '[id^="username-"]',
  // Semantic
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[name="email"]',
  'input[name="username"]',
  // Placeholder heuristic (Replit uses "Enter your email")
  'input[placeholder*="email" i]',
  'input[placeholder*="Email" i]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  '[role="button"][type="submit"]',
  // Replit's ContinueButton aria pattern
  'button[aria-label*="continue" i]',
  'button[aria-label*="next" i]',
  'button[aria-label*="sign" i]',
];

// ── State ─────────────────────────────────────────────────────
let observer    = null;
let attached    = false;
let lastEmail   = '';
let formVisible = false;

// ── Helpers ───────────────────────────────────────────────────

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function findEmailInput() {
  for (const sel of EMAIL_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch(_) {}
  }
  return null;
}

function findSubmitBtn() {
  for (const sel of SUBMIT_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch(_) {}
  }
  return null;
}

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

// ── Submit handler ────────────────────────────────────────────

function handleSubmit() {
  const input = findEmailInput();
  const email = (input?.value || lastEmail || '').trim().toLowerCase();
  if (email && isValidEmail(email)) {
    lastEmail = email;
    chrome.storage.local.set({ currentActiveEmail: email, formDetected: false });
    send('EMAIL_SUBMITTED', { email });
  }
}

// ── Attach form listeners ─────────────────────────────────────

function attachFormListeners() {
  const emailInput = findEmailInput();
  if (!emailInput) return false;

  // Notify background that form is now visible
  if (!formVisible) {
    formVisible = true;
    chrome.storage.local.set({ formDetected: true });
    send('FORM_DETECTED');
  }

  if (attached) return true;
  attached = true;

  // Track value as user types (fallback for click timing)
  emailInput.addEventListener('input', () => {
    lastEmail = emailInput.value.trim().toLowerCase();
  });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      lastEmail = emailInput.value.trim().toLowerCase();
      handleSubmit();
    }
  });

  // Attach to submit button
  const submitBtn = findSubmitBtn();
  if (submitBtn) {
    submitBtn.addEventListener('click', handleSubmit, { capture: true });
    // Also intercept mousedown so we get the value before blur clears it
    submitBtn.addEventListener('mousedown', () => {
      const input = findEmailInput();
      if (input) lastEmail = input.value.trim().toLowerCase();
    }, { capture: true });
  }

  // Also intercept form submit
  const form = emailInput.closest('form');
  if (form) {
    form.addEventListener('submit', handleSubmit, { capture: true });
  }

  return true;
}

// ── Navigation handler (SPA) ──────────────────────────────────

function handleNavigation() {
  const url = window.location.href;

  if (HOME_PATTERN.test(url)) {
    // Landed on /~ after login — broadcast success with last email
    chrome.storage.local.get(['currentActiveEmail'], (r) => {
      const email = r.currentActiveEmail || lastEmail;
      if (email && isValidEmail(email)) {
        chrome.storage.local.set({ currentActiveEmail: email, formDetected: false });
        send('LOGIN_SUCCESS', { email });
      }
    });
    return;
  }

  // Page changed — reset and re-observe
  attached    = false;
  formVisible = false;
  stopObserver();
  startObserver();
}

// ── MutationObserver ──────────────────────────────────────────

function stopObserver() {
  if (observer) { observer.disconnect(); observer = null; }
}

function startObserver() {
  if (attachFormListeners()) return;

  observer = new MutationObserver(() => {
    if (attachFormListeners()) stopObserver();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// ── Patch SPA navigation ──────────────────────────────────────

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);

  history.pushState = (...args) => { _push(...args);    setTimeout(handleNavigation, 50); };
  history.replaceState = (...args) => { _replace(...args); setTimeout(handleNavigation, 50); };
})();

window.addEventListener('popstate', () => setTimeout(handleNavigation, 50));

// ── Init ──────────────────────────────────────────────────────

// Clear stale formDetected on fresh page load
chrome.storage.local.set({ formDetected: false });
startObserver();
