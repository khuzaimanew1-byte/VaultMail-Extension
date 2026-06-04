'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Why this approach:
//   DOM selector detection is fragile — Replit uses Clerk Auth
//   whose inputs use name="identifier" (not type="email") and
//   React-Aria IDs that change every build. So we use a two-track
//   strategy:
//
//   Track 1 — URL-based (always reliable):
//     If URL matches /login → set formDetected = true immediately
//     If URL matches /~     → login succeeded, emit LOGIN_SUCCESS
//
//   Track 2 — DOM-based (best-effort, for capturing the email):
//     Retry every 250ms for up to 10s to find any email input.
//     On every keystroke, persist value to storage as pendingEmail.
//     On redirect to /~, promote pendingEmail → currentActiveEmail.
// ============================================================

const HOME_PATTERN  = /^https:\/\/replit\.com\/(~|home|dashboard|repls)/;
const LOGIN_PATTERN = /^https:\/\/replit\.com\/(login|signin|sign-in|auth|account\/sign)/i;

// Clerk uses name="identifier". All known variations listed here.
const EMAIL_SELECTORS = [
  'input[name="identifier"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[placeholder*="email" i]',
  '[id^="username-"]',
  '[id^="identifier-"]',
];

// ── State ─────────────────────────────────────────────────────

let listenersAttached = false;
let pendingEmail      = '';
let retryTimer        = null;
let retryCount        = 0;
const MAX_RETRIES     = 40; // 40 × 250ms = 10s

// ── Helpers ───────────────────────────────────────────────────

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function findEmailInput() {
  for (const sel of EMAIL_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (_) {}
  }
  return null;
}

function savePending(value) {
  const v = (value || '').trim().toLowerCase();
  if (!v) return;
  pendingEmail = v;
  // Write synchronously so redirect can read it even after navigation
  chrome.storage.local.set({ pendingEmail: v });
}

// ── Track-2: DOM email capture ────────────────────────────────

function tryAttachListeners() {
  if (listenersAttached) return true;
  const input = findEmailInput();
  if (!input) return false;

  listenersAttached = true;

  input.addEventListener('input',  () => savePending(input.value));
  input.addEventListener('change', () => savePending(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePending(input.value); });

  // Capture on form submit / button click
  const capture = () => savePending(input.value);
  document.querySelectorAll('form, button[type="submit"]').forEach(el => {
    el.addEventListener('submit',    capture, { capture: true });
    el.addEventListener('mousedown', capture, { capture: true });
    el.addEventListener('click',     capture, { capture: true });
  });

  return true;
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryCount = 0;
  tick();
}

function tick() {
  if (tryAttachListeners()) return;
  if (retryCount++ < MAX_RETRIES) {
    retryTimer = setTimeout(tick, 250);
  }
}

// MutationObserver as another retry path
let observer = null;

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (tryAttachListeners()) { observer.disconnect(); observer = null; }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// ── Track-1: URL-based state machine ─────────────────────────

function onUrlChange() {
  const url = window.location.href;

  if (HOME_PATTERN.test(url)) {
    // Landed on home — login completed
    chrome.storage.local.get(['pendingEmail', 'currentActiveEmail'], (r) => {
      const email = pendingEmail || r.pendingEmail || r.currentActiveEmail || '';
      if (isValidEmail(email)) {
        chrome.storage.local.set({
          currentActiveEmail: email,
          pendingEmail:       null,
          formDetected:       false,
        });
        send('LOGIN_SUCCESS', { email });
      } else {
        // Already logged in / OAuth — just clear form state
        chrome.storage.local.set({ formDetected: false });
        send('FORM_CLEARED');
      }
    });
    listenersAttached = false;
    pendingEmail      = '';
    return;
  }

  if (LOGIN_PATTERN.test(url)) {
    // Login page confirmed by URL — no DOM query needed
    chrome.storage.local.set({ formDetected: true });
    send('FORM_DETECTED');

    // Also attempt DOM capture for the email value
    listenersAttached = false;
    startObserver();
    scheduleRetry();
    return;
  }

  // Any other Replit page — clear processing state
  clearTimeout(retryTimer);
  chrome.storage.local.set({ formDetected: false });
  listenersAttached = false;
}

// ── Capture on page unload (safety net) ──────────────────────

window.addEventListener('pagehide', () => {
  const input = findEmailInput();
  if (input?.value) savePending(input.value);
});

// ── SPA navigation patching ───────────────────────────────────

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onUrlChange, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onUrlChange, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onUrlChange, 80));

// ── Init ──────────────────────────────────────────────────────

// Restore any pending email that survived a previous page load
chrome.storage.local.get(['pendingEmail'], (r) => {
  if (r.pendingEmail) pendingEmail = r.pendingEmail;
});

// Evaluate current URL immediately
onUrlChange();
