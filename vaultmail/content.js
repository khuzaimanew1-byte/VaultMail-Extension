'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Detection strategy: selector-only (no URL-based form detection).
// MutationObserver recalculates formDetected on every DOM change.
// pendingEmail is saved on every keystroke — not on submit.
// LOGIN_SUCCESS fires when URL becomes /~ AND pendingEmail exists.
// ============================================================

const HOME_PATTERN = /^https:\/\/replit\.com\/~/;

// These are the exact Replit login form selectors.
// Attribute form avoids CSS escaping issues with colons.
const SELECTORS = {
  emailInput: '[id="username-:rv:"]',
  submitBtn:  '[id="react-aria1080582148-:r1c:"]',
};

// ── State ─────────────────────────────────────────────────────

let currentFormDetected = false;
let pendingEmail        = '';
let loginInProgress     = false;

// ── Helpers ───────────────────────────────────────────────────

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function getFormEls() {
  return {
    emailInput: document.querySelector(SELECTORS.emailInput),
    submitBtn:  document.querySelector(SELECTORS.submitBtn),
  };
}

// ── Core: recalculate formDetected from DOM ───────────────────

function updateFormDetected() {
  const { emailInput, submitBtn } = getFormEls();
  const detected = !!(emailInput && submitBtn);

  if (detected === currentFormDetected) return; // no change
  currentFormDetected = detected;

  chrome.storage.local.set({ formDetected: detected });
  send(detected ? 'FORM_DETECTED' : 'FORM_CLEARED');

  if (detected) {
    attachEmailTracking(emailInput, submitBtn);
  }
}

// ── Email tracking — attach once per form appearance ─────────

let trackingAttached = false;

function attachEmailTracking(emailInput, submitBtn) {
  if (trackingAttached) return;
  trackingAttached = true;

  // Save every keystroke immediately
  const saveEmail = () => {
    const v = emailInput.value.trim().toLowerCase();
    if (v) {
      pendingEmail = v;
      chrome.storage.local.set({ pendingEmail: v });
    }
  };

  emailInput.addEventListener('input',  saveEmail);
  emailInput.addEventListener('change', saveEmail);

  // On submit: mark loginInProgress
  const onSubmit = () => {
    chrome.storage.local.get(['pendingEmail'], (r) => {
      const email = r.pendingEmail || pendingEmail;
      if (email) {
        loginInProgress = true;
        chrome.storage.local.set({ loginInProgress: true });
      }
    });
  };

  submitBtn.addEventListener('click',     onSubmit, { capture: true });
  submitBtn.addEventListener('mousedown', saveEmail, { capture: true });

  const form = emailInput.closest('form');
  if (form) form.addEventListener('submit', onSubmit, { capture: true });
}

// ── MutationObserver — recompute on every DOM change ─────────

const observer = new MutationObserver(updateFormDetected);

function startObserver() {
  observer.observe(document.documentElement, {
    childList: true,
    subtree:   true,
  });
}

// ── Navigation / redirect detection ──────────────────────────

function onNavigate() {
  const url = window.location.href;

  if (HOME_PATTERN.test(url)) {
    // Login redirect completed — promote pendingEmail
    chrome.storage.local.get(['pendingEmail', 'currentActiveEmail'], (r) => {
      const email = pendingEmail || r.pendingEmail || r.currentActiveEmail || '';

      if (isValidEmail(email)) {
        chrome.storage.local.set({
          currentActiveEmail: email,
          pendingEmail:       null,
          formDetected:       false,
          loginInProgress:    false,
        });
        send('LOGIN_SUCCESS', { email });
      } else {
        chrome.storage.local.set({ formDetected: false, loginInProgress: false });
        send('FORM_CLEARED');
      }
    });

    // Reset local state
    currentFormDetected = false;
    trackingAttached    = false;
    loginInProgress     = false;
    pendingEmail        = '';
    return;
  }

  // Page changed — reset tracking so we can re-attach on new form
  trackingAttached    = false;
  currentFormDetected = false;
  chrome.storage.local.set({ formDetected: false, loginInProgress: false });

  // Re-run immediately for new page content
  setTimeout(updateFormDetected, 100);
}

// ── SPA navigation patching ───────────────────────────────────

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onNavigate, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onNavigate, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onNavigate, 80));

// Capture email on pagehide (safety net for fast navigations)
window.addEventListener('pagehide', () => {
  const { emailInput } = getFormEls();
  if (emailInput?.value) {
    const v = emailInput.value.trim().toLowerCase();
    if (v) chrome.storage.local.set({ pendingEmail: v });
  }
});

// ── Init ──────────────────────────────────────────────────────

// Restore any pending email from previous page load
chrome.storage.local.get(['pendingEmail'], (r) => {
  if (r.pendingEmail) pendingEmail = r.pendingEmail;
});

// Clear stale form state on fresh load
chrome.storage.local.set({ formDetected: false, loginInProgress: false });

// Start observer + initial check
startObserver();
updateFormDetected();
