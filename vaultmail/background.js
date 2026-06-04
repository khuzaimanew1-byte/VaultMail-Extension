'use strict';

// ============================================================
// BACKGROUND SERVICE WORKER
// Monitors Replit tabs even when the user is not focused on them.
// Forwards tab URL changes to storage so the popup can react.
// ============================================================

const REPLIT_ORIGIN = 'https://replit.com';
const HOME_RE = /^https:\/\/replit\.com\/~(.+)/;

// Track last known URL per tab so we only fire on actual changes
const tabUrls = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url || !tab.url.startsWith(REPLIT_ORIGIN)) return;
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;

  const url = changeInfo.url || tab.url;

  // Skip if URL hasn't actually changed
  if (tabUrls[tabId] === url) return;
  tabUrls[tabId] = url;

  // If the page redirected to /~ (home/dashboard), preserve currentActiveEmail
  if (HOME_RE.test(url)) {
    // Just ensure we don't accidentally clear it — storage write is controlled
    // by content script; nothing to do here.
    broadcastToPopup({ type: 'URL_CHANGED', url, isHome: true });
  } else {
    broadcastToPopup({ type: 'URL_CHANGED', url, isHome: false });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabUrls[tabId];
});

// Send a message to the popup if it's open.
// This uses chrome.runtime.sendMessage which the popup listens to.
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup not open — silently ignore
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EMAIL_SUBMITTED') {
    const email = message.email;
    if (email) {
      chrome.storage.local.set({ currentActiveEmail: email }, () => {
        broadcastToPopup({ type: 'ACTIVE_EMAIL_UPDATED', email });
        sendResponse({ ok: true });
      });
      return true; // keep channel open for async sendResponse
    }
  }
});
