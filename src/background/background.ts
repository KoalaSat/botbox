/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and background tasks
 */

// Inline types and enums to avoid code splitting
enum MessageType {
  PING = 'PING',
  GET_DATA = 'GET_DATA',
  SET_DATA = 'SET_DATA',
  NOTIFY = 'NOTIFY',
}

interface Message {
  type: MessageType;
  payload?: any;
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

console.log('Background service worker initialized');

/**
 * Listen for installation events
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details);
  
  // Set default storage values
  chrome.storage.local.set({
    initialized: true,
    installDate: new Date().toISOString(),
  });
});

/**
 * Listen for messages from popup or content scripts
 */
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: MessageResponse) => void) => {
    console.log('Background received message:', message, 'from:', sender);

    // Handle different message types
    switch (message.type) {
      case MessageType.PING:
        sendResponse({ success: true, data: 'pong' });
        break;

      case MessageType.GET_DATA:
        handleGetData(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response

      case MessageType.SET_DATA:
        handleSetData(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response

      case MessageType.NOTIFY:
        console.log('Notification:', message.payload);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }
);

/**
 * Handle GET_DATA messages
 */
async function handleGetData(key?: string): Promise<any> {
  if (key) {
    const result = await chrome.storage.local.get(key);
    return result[key];
  } else {
    return await chrome.storage.local.get(null);
  }
}

/**
 * Handle SET_DATA messages
 */
async function handleSetData(data: Record<string, any>): Promise<void> {
  await chrome.storage.local.set(data);
}

/**
 * Listen for tab updates (example: detect page navigation)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('Tab completed loading:', tab.url);
  }
});

/**
 * Handle extension icon clicks (if you want custom behavior beyond opening popup)
 */
chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked on tab:', tab.id);
});
