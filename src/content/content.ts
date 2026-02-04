/**
 * Content Script
 * Runs in the context of web pages to access window.nostr (NIP-07)
 */

console.log('BotBox Extension - Content script loaded');

// This content script serves as a bridge to access window.nostr
// which is injected by NIP-07 extensions like Alby, nos2x, etc.

// Listen for messages from the popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message);
  
  // Handle messages if needed
  sendResponse({ success: true });
});

export {};
