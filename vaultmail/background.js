'use strict';

// ============================================================
// BACKGROUND SERVICE WORKER
// ============================================================

const REPLIT_ORIGIN = 'https://replit.com';

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
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
  updateReplitActive();
});

// Seed on service worker start
chrome.tabs.query({}, (tabs) => {
  for (const t of tabs) if (t.url) tabUrls.set(t.id, t.url);
  updateReplitActive();
});

// ── Message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Content script captured an email on button click
  if (message.type === 'ACTIVE_EMAIL_UPDATED') {
    const { email } = message;
    if (email) {
      chrome.storage.local.set({ currentActiveEmail: email }, () => {
        broadcastToPopup({ type: 'ACTIVE_EMAIL_UPDATED', email });
        sendResponse({ ok: true });
      });
      return true;
    }
  }

});
