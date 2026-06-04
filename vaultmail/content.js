'use strict';

// ============================================================
// CONTENT SCRIPT — runs on https://replit.com/*
// Watches for email input submission and persists the address.
// ============================================================

const EMAIL_INPUT_SELECTOR  = '#username-\\:rv\\:';
const SUBMIT_BTN_SELECTOR   = '#react-aria1080582148-\\:r1c\\:';
const HOME_PATTERN          = /^https:\/\/replit\.com\/~.*/;

let observer = null;
let attached = false;

// ── Attach listeners to the login form elements ──────────────

function attachFormListeners() {
  // Use un-escaped selectors for querySelector (CSS escape is only for the
  // attribute selector context; querySelector handles colons fine with quotes)
  const emailInput = document.querySelector('[id="username-:rv:"]');
  const submitBtn  = document.querySelector('[id="react-aria1080582148-:r1c:"]');

  if (!emailInput || !submitBtn) return false;
  if (attached) return true;

  submitBtn.addEventListener('click', () => {
    const email = (emailInput.value || '').trim().toLowerCase();
    if (email && isValidEmail(email)) {
      // Persist immediately in storage
      chrome.storage.local.set({ currentActiveEmail: email });
      // Also notify the background service worker
      chrome.runtime.sendMessage({ type: 'EMAIL_SUBMITTED', email }).catch(() => {});
    }
  }, { capture: true });

  // Also listen for Enter key on the input
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const email = (emailInput.value || '').trim().toLowerCase();
      if (email && isValidEmail(email)) {
        chrome.storage.local.set({ currentActiveEmail: email });
        chrome.runtime.sendMessage({ type: 'EMAIL_SUBMITTED', email }).catch(() => {});
      }
    }
  });

  attached = true;
  return true;
}

// ── MutationObserver — watch for dynamic element insertion ───

function startObserver() {
  if (observer) return;

  // Try immediately first
  if (attachFormListeners()) return;

  observer = new MutationObserver(() => {
    if (attachFormListeners()) {
      observer.disconnect();
      observer = null;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Navigation change detection (SPA) ────────────────────────

function handleNavigation() {
  const url = window.location.href;
  if (HOME_PATTERN.test(url)) {
    // Landed on /~ — preserve currentActiveEmail, do not clear
    return;
  }
  // Reset attached flag when page view changes so we can re-attach
  attached = false;
  startObserver();
}

// Intercept pushState / replaceState for SPA navigation
(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _push(...args);
    handleNavigation();
  };

  history.replaceState = function (...args) {
    _replace(...args);
    handleNavigation();
  };
})();

window.addEventListener('popstate', handleNavigation);

// ── Helpers ───────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Init ─────────────────────────────────────────────────────

startObserver();
