'use strict';

// ============================================================
// BACKGROUND SERVICE WORKER
//
// Responsibilities:
//   - Track which browser tabs are on Replit
//   - Broadcast REPLIT_STATUS_CHANGED to popup when status changes
//
// FIXED (was orphaned):
//   - Was writing 'captureStatus' → now correctly writes nothing (content.js owns state)
//   - Was writing 'currentActiveEmail' → removed (content.js owns state)
//   - Was broadcasting 'STATUS_CHANGED' → now broadcasts 'REPLIT_STATUS_CHANGED'
//   - Was broadcasting 'ACTIVE_EMAIL_UPDATED' → removed
// ============================================================

const REPLIT_ORIGIN = 'https://replit.com';

const tabUrls = new Map(); // tabId → url (in-memory only, not persisted)

function isReplitUrl(url) {
  return url && url.startsWith(REPLIT_ORIGIN);
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

let lastReplitActive = null; // track previous state to avoid redundant broadcasts

function updateReplitActive() {
  const active = [...tabUrls.values()].some(u => isReplitUrl(u));

  // Only broadcast when state actually changes
  if (active === lastReplitActive) return;
  lastReplitActive = active;

  broadcastToPopup({ type: 'REPLIT_STATUS_CHANGED', active });
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

// Seed tab map on service worker start
chrome.tabs.query({}, (tabs) => {
  for (const t of tabs) if (t.url) tabUrls.set(t.id, t.url);
  // Compute initial state after seeding
  lastReplitActive = null;
  updateReplitActive();
});
