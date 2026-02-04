/**
 * Shared messaging types and utilities for communication between
 * different parts of the extension (popup, background, content scripts)
 */

export enum MessageType {
  GET_DATA = 'GET_DATA',
  SET_DATA = 'SET_DATA',
  NOTIFY = 'NOTIFY',
  PING = 'PING',
  
  // Nostr operations
  SIMPLE_LOGIN = 'SIMPLE_LOGIN',
  FETCH_USER_DATA = 'FETCH_USER_DATA',
  FETCH_CONTACTS = 'FETCH_CONTACTS',
  LOGOUT = 'LOGOUT',
  GET_LOGIN_STATUS = 'GET_LOGIN_STATUS',
  
  // Relay management (NIP-65)
  FETCH_RELAYS = 'FETCH_RELAYS',
  
  // Refresh all data (profile, contacts, relays)
  REFRESH_DATA = 'REFRESH_DATA',
  
  // Outbox model events
  GET_OUTBOX_MODEL_EVENTS = 'GET_OUTBOX_MODEL_EVENTS',
  GET_OUTBOX_MODEL_STATUS = 'GET_OUTBOX_MODEL_STATUS',
  CONNECT_OUTBOX_MODEL = 'CONNECT_OUTBOX_MODEL',
  DISCONNECT_OUTBOX_MODEL = 'DISCONNECT_OUTBOX_MODEL',
  
  // Inbox scanner
  GET_INBOX_SCANNER_STATUS = 'GET_INBOX_SCANNER_STATUS',
  GET_INBOX_SCANNER_EVENTS = 'GET_INBOX_SCANNER_EVENTS',
  TRIGGER_INBOX_SCAN = 'TRIGGER_INBOX_SCAN',
  STOP_INBOX_SCAN = 'STOP_INBOX_SCAN',
  TOGGLE_INBOX_SCANNER = 'TOGGLE_INBOX_SCANNER',
}

export interface Message {
  type: MessageType;
  payload?: any;
}

export interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Send a message to the background script
 * Uses Promise-based approach for Firefox compatibility
 */
export async function sendToBackground(message: Message): Promise<MessageResponse> {
  try {
    // Firefox-compatible: wrap chrome.runtime.sendMessage in a Promise
    const response = await new Promise<MessageResponse>((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        // Handle undefined response (Firefox issue)
        if (!response) {
          console.warn('Received undefined response from background script');
          resolve({
            success: false,
            error: 'No response from background script',
          });
          return;
        }
        
        resolve(response);
      });
    });
    
    return response;
  } catch (error) {
    console.error('Error sending message to background:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send a message to a specific tab
 */
export async function sendToTab(tabId: number, message: Message): Promise<MessageResponse> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error) {
    console.error('Error sending message to tab:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send a message to the active tab
 */
export async function sendToActiveTab(message: Message): Promise<MessageResponse> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    
    // Check if it's a valid URL that can have content scripts
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || 
        tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://'))) {
      throw new Error('Content scripts cannot run on browser internal pages. Please navigate to a regular webpage (http:// or https://)');
    }
    
    return await sendToTab(tab.id, message);
  } catch (error) {
    console.error('Error sending message to active tab:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
