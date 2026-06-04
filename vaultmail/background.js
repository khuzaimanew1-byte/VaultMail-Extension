'use strict';

// ============================================================
// BACKGROUND SERVICE WORKER
// ============================================================

const REPLIT_ORIGIN = 'https://replit.com';
const HOME_RE       = /^https:\/\/replit\.com\/(~|home|dashboard)/;

const tabUrls = new Map();

function isReplitUrl(url) {
  return url && url.startsWith(REPLIT_ORIGIN);
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function updateReplitActive() {
  const active = [...tabUrls.values()].some(u => isReplitUrl(u));
  chrome.storage.local.set({ replitActive: active }, () => {
    broadcastToPopup({ type: 'REPLIT_STATUS_CHANGED', active });
  });
}

// ── Tab lifecycle ─────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url) return;

  const prev = tabUrls.get(tabId);
  tabUrls.set(tabId, url);
  if (prev === url) return;

  updateReplitActive();

  if (isReplitUrl(url) && (changeInfo.status === 'complete' || changeInfo.url)) {
    broadcastToPopup({ type: 'URL_CHANGED', url, isHome: HOME_RE.test(url) });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
  updateReplitActive();
});

// Seed on startup
chrome.tabs.query({}, (tabs) => {
  for (const t of tabs) if (t.url) tabUrls.set(t.id, t.url);
  updateReplitActive();
});

// ── Message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Login form visible (URL-confirmed by content script)
  if (message.type === 'FORM_DETECTED') {
    chrome.storage.local.set({ formDetected: true }, () => {
      broadcastToPopup({ type: 'FORM_DETECTED' });
    });
    return;
  }

  // Login form gone (navigated away without completing login)
  if (message.type === 'FORM_CLEARED') {
    chrome.storage.local.set({ formDetected: false }, () => {
      broadcastToPopup({ type: 'FORM_CLEARED' });
    });
    return;
  }

  // Page redirected to /~ — login completed
  if (message.type === 'LOGIN_SUCCESS') {
    const { email } = message;
    const updates = { formDetected: false, pendingEmail: null };
    if (email) updates.currentActiveEmail = email;

    chrome.storage.local.set(updates, () => {
      chrome.storage.local.get(['currentActiveEmail'], (r) => {
        const finalEmail = r.currentActiveEmail;
        if (finalEmail) {
          broadcastToPopup({ type: 'ACTIVE_EMAIL_UPDATED', email: finalEmail });
        }
      });
    });
    return;
  }
});
