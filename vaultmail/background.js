'use strict';

// ============================================================
// BACKGROUND SERVICE WORKER
// Tracks Replit tab presence and forwards email submissions.
// ============================================================

const REPLIT_ORIGIN = 'https://replit.com';
const HOME_RE       = /^https:\/\/replit\.com\/~.+/;

const tabUrls = new Map();  // tabId → url

// ── Helpers ──────────────────────────────────────────────────

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

// Seed initial state on service worker start
chrome.tabs.query({}, (tabs) => {
  for (const t of tabs) if (t.url) tabUrls.set(t.id, t.url);
  updateReplitActive();
});

// ── Message handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EMAIL_SUBMITTED') {
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
