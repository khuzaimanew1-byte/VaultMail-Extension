'use strict';

// ============================================================
// CONTENT SCRIPT — https://replit.com/*
//
// Architecture: interaction-first
//   - INTERACTION_LISTENER: ACTIVE (focusin + click on document)
//   - CONTINUOUS_DOM_SCAN:  NO
//   - MUTATION_OBSERVER:    NO
//   - INTERVAL_SCANNER:     NO
//   - CONTEXT_LOCKING:      active once email+form+button found
// ============================================================

// ── Email input candidates ────────────────────────────────────
// Ordered by specificity. Only these patterns are supported.

const EMAIL_CANDIDATES = [
  { sel: 'input[autocomplete="email"]',              label: 'input[autocomplete="email"]' },
  { sel: 'input[name="email"]',                      label: 'input[name="email"]' },
  { sel: 'input[name="username"][autocomplete="email"]', label: 'input[name="username"][autocomplete="email"]' },
  // Fallback: any username field (wider net for forms without autocomplete attr)
  { sel: 'input[name="username"]',                   label: 'input[name="username"]' },
];

// ── Locked capture context ────────────────────────────────────

let activeEmailInput   = null;
let activeForm         = null;
let activeSubmitBtn    = null;
let contextLocked      = false;
let activeSelector     = '-';

// ── Helpers ───────────────────────────────────────────────────

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}

function saveEmail(email) {
  if (!email) return;
  chrome.storage.local.set({ currentActiveEmail: email });
  send('ACTIVE_EMAIL_UPDATED', { email });
}

function setStatus(status) {
  chrome.storage.local.set({ captureStatus: status });
  send('STATUS_CHANGED', { status });
  writeDebug({ statusOverride: status });
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

// ── Debug writer — persists state for testing panel ──────────

function writeDebug(patch = {}) {
  const info = {
    tagName:      patch.tagName      !== undefined ? patch.tagName      : '-',
    detectedTarget: patch.detectedTarget !== undefined ? patch.detectedTarget : false,
    emailCandidate: patch.emailCandidate !== undefined ? patch.emailCandidate : false,
    formFound:    patch.formFound    !== undefined ? patch.formFound    : false,
    submitFound:  patch.submitFound  !== undefined ? patch.submitFound  : false,
    activeSelector: patch.activeSelector || activeSelector,
    contextLocked:  patch.contextLocked  !== undefined ? patch.contextLocked  : contextLocked,
    currentStatus:  patch.statusOverride || (
      contextLocked && activeSubmitBtn ? 'previewing' :
      contextLocked ? 'processing' : 'activated'
    ),
    ts: Date.now(),
  };
  chrome.storage.local.set({ vmDebug: info });
  send('DEBUG_UPDATED', { debug: info });
}

// ── Submit button click handler ───────────────────────────────

function onSubmitClicked() {
  console.log('[VaultMail] Submit clicked');
  if (!activeEmailInput || !document.contains(activeEmailInput)) {
    console.log('[VaultMail] Email input gone — resetting');
    resetContext();
    return;
  }
  const val = activeEmailInput.value.trim().toLowerCase();
  console.log('[VaultMail] Capturing email:', val || '(empty)');
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
  const submitFound = !!activeSubmitBtn;
  console.log('[VaultMail] Upgrade attempt — submit found:', submitFound);
  if (activeSubmitBtn) {
    attachSubmitListener();
    setStatus('previewing');
  }
  writeDebug({
    formFound:   !!activeForm,
    submitFound,
  });
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
    if (activeSubmitBtn) attachSubmitListener();
  }
}

// ── Lock context on first email input interaction ─────────────

function lockContext(emailInput, selector) {
  console.log('[VaultMail] Context locked — selector:', selector);
  activeSelector   = selector;
  contextLocked    = true;
  activeEmailInput = emailInput;
  activeForm       = emailInput.form || emailInput.closest('form');
  activeSubmitBtn  = findSubmitInForm(activeForm);

  const formFound   = !!activeForm;
  const submitFound = !!activeSubmitBtn;

  console.log('[VaultMail] Form found:', formFound, '| Submit found:', submitFound);

  writeDebug({
    emailCandidate: true,
    formFound,
    submitFound,
    activeSelector: selector,
    contextLocked: true,
  });

  if (activeSubmitBtn) {
    attachSubmitListener();
    setStatus('previewing');
  } else {
    setStatus('processing');
  }

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmitClicked();
  });

  if (activeForm) {
    activeForm.addEventListener('submit', onSubmitClicked, { capture: true });
  }
}

// ── Reset all context ─────────────────────────────────────────

function resetContext() {
  console.log('[VaultMail] Context reset');
  activeEmailInput = null;
  activeForm       = null;
  activeSubmitBtn  = null;
  contextLocked    = false;
  activeSelector   = '-';
  setStatus('activated');
}

// ── Core interaction handler ──────────────────────────────────

function onEmailInteraction(e) {
  const target = e.target;

  // Log every interaction for debug
  const tagName = target ? target.tagName : 'null';
  console.log('[VaultMail] Interaction:', e.type, tagName);

  if (!target || target.tagName !== 'INPUT') {
    writeDebug({ tagName, detectedTarget: false });
    return;
  }

  writeDebug({ tagName, detectedTarget: true });

  // Check each candidate selector
  let matchedSel = null;
  for (const { sel, label } of EMAIL_CANDIDATES) {
    try {
      if (target.matches(sel)) { matchedSel = label; break; }
    } catch (_) {}
  }

  if (!matchedSel) {
    console.log('[VaultMail] Not an email candidate:', target.name, target.autocomplete, target.type);
    writeDebug({ tagName, detectedTarget: true, emailCandidate: false });
    return;
  }

  console.log('[VaultMail] Email candidate matched:', matchedSel);

  if (contextLocked) {
    if (target !== activeEmailInput) {
      console.log('[VaultMail] Different email field — re-locking');
      resetContext();
      lockContext(target, matchedSel);
    } else if (!activeSubmitBtn) {
      tryUpgradeToPreview();
    } else {
      ensureContextValid();
    }
    return;
  }

  lockContext(target, matchedSel);
}

// Three event types to maximize chance of catching interaction
document.addEventListener('focusin', onEmailInteraction, { capture: true });
document.addEventListener('click',   onEmailInteraction, { capture: true });
document.addEventListener('input',   onEmailInteraction, { capture: true });

// ── SPA navigation ────────────────────────────────────────────

function onNavigate() {
  console.log('[VaultMail] SPA navigation — resetting');
  resetContext();
}

(function patchHistory() {
  const _push    = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);
  history.pushState    = (...a) => { _push(...a);    setTimeout(onNavigate, 80); };
  history.replaceState = (...a) => { _replace(...a); setTimeout(onNavigate, 80); };
})();

window.addEventListener('popstate', () => setTimeout(onNavigate, 80));

// ── Init ──────────────────────────────────────────────────────

console.log('[VaultMail] Content script loaded');

// Report architecture state
const ARCH = {
  interactionListener: true,
  continuousDomScan:   false,
  mutationObserver:    false,
  intervalScanner:     false,
};
chrome.storage.local.set({ vmArch: ARCH });

setStatus('activated');
