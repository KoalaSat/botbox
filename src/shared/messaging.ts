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
  CONNECT_NIP07 = 'CONNECT_NIP07',
  NIP07_LOGIN = 'NIP07_LOGIN',
  FETCH_USER_DATA = 'FETCH_USER_DATA',
  FETCH_CONTACTS = 'FETCH_CONTACTS',
  REMOVE_CONTACT = 'REMOVE_CONTACT',
  ADD_CONTACT = 'ADD_CONTACT',
  LOGOUT = 'LOGOUT',
  GET_LOGIN_STATUS = 'GET_LOGIN_STATUS',
  
  // Relay management (NIP-65)
  FETCH_RELAYS = 'FETCH_RELAYS',
  ADD_RELAY = 'ADD_RELAY',
  REMOVE_RELAY = 'REMOVE_RELAY',
  UPDATE_RELAY_TYPE = 'UPDATE_RELAY_TYPE',
  PUBLISH_RELAY_LIST = 'PUBLISH_RELAY_LIST',
  
  // Refresh all data (profile, contacts, relays)
  REFRESH_DATA = 'REFRESH_DATA',
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
 */
export async function sendToBackground(message: Message): Promise<MessageResponse> {
  try {
    const response = await chrome.runtime.sendMessage(message);
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
