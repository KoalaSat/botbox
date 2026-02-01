/**
 * Content Script
 * Runs in the context of web pages, can access and modify the DOM
 */

// Inline types and enums to avoid code splitting
enum MessageType {
  PING = 'PING',
  GET_DATA = 'GET_DATA',
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

console.log('Content script loaded on:', window.location.href);

/**
 * Listen for messages from background or popup
 */
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: MessageResponse) => void) => {
    console.log('Content script received message:', message);

    switch (message.type) {
      case MessageType.PING:
        sendResponse({ success: true, data: 'pong from content script' });
        break;

      case MessageType.GET_DATA:
        // Example: Get page title or other DOM data
        sendResponse({
          success: true,
          data: {
            title: document.title,
            url: window.location.href,
          },
        });
        break;

      case MessageType.NOTIFY:
        // Example: Show notification on page
        showPageNotification(message.payload?.message || 'Notification from extension');
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep message channel open for response
  }
);

/**
 * Example function to inject notification into the page
 */
function showPageNotification(message: string) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 16px;
    border-radius: 4px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    z-index: 10000;
    font-family: sans-serif;
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Example: Observe DOM changes
 */
function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    // Handle DOM mutations
    console.log('DOM changed:', mutations.length, 'mutations');
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Uncomment to enable DOM observation
// observeDOMChanges();

/**
 * Initialize content script
 */
function init() {
  console.log('Content script initialized');
  
  // Send notification to background that content script is ready
  chrome.runtime.sendMessage({
    type: MessageType.NOTIFY,
    payload: { message: 'Content script ready', url: window.location.href },
  });
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
