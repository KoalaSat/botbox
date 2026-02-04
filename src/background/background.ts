/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and Nostr operations
 */

import { RelayManager } from '../services/relayManager';
import { ContactsManager } from '../services/contactsManager';
import { ProfileManager } from '../services/profileManager';
import { RelayListManager } from '../services/relayListManager';
import { Database, type UserData, type RelayMetadata } from '../services/db';
import { fetchRelayInfoBatch } from '../services/nip11';
import { OutboxModelService } from '../services/outboxModel';
import { InboxScannerService } from '../services/inboxScanner';
import {
  handleAsync,
  handleAsyncWithPayload,
  handleAsyncVoid,
  handleAsyncVoidWithPayload,
} from './messageHandler';
import type { Event as NostrEvent } from 'nostr-tools';
import { MessageType } from '../shared/messaging';

// =============================================================================
// Types and Enums
// =============================================================================

interface Message {
  type: MessageType;
  payload?: any;
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

// =============================================================================
// Global State
// =============================================================================

console.log('Background service worker initialized');

let relayManager: RelayManager | null = null;
let outboxModel: OutboxModelService | null = null;
let inboxScanner: InboxScannerService | null = null;

// =============================================================================
// Relay Manager
// =============================================================================

/**
 * Get or create relay manager with user's relays if available
 */
async function getRelayManager(): Promise<RelayManager> {
  if (!relayManager) {
    const userData = await Database.getUserData();
    if (userData && userData.relays && userData.relays.length > 0) {
      console.log(`[Background] Initializing relay manager with ${userData.relays.length} user relays`);
      relayManager = new RelayManager(userData.relays);
    } else {
      console.log('[Background] Initializing relay manager with default relays');
      relayManager = RelayManager.createDefault();
    }
  }
  return relayManager;
}

// =============================================================================
// Outbox Model
// =============================================================================

/**
 * Get or create outbox model service
 */
function getOutboxModel(): OutboxModelService {
  if (!outboxModel) {
    outboxModel = new OutboxModelService(getRelayManager);
  }
  return outboxModel;
}

/**
 * Get or create inbox scanner service
 */
function getInboxScanner(): InboxScannerService {
  if (!inboxScanner) {
    inboxScanner = new InboxScannerService(getRelayManager);
  }
  return inboxScanner;
}

// =============================================================================
// Chrome Extension Lifecycle
// =============================================================================

/**
 * Listen for installation events
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details);
  
  chrome.storage.local.set({
    initialized: true,
    installDate: new Date().toISOString(),
  });
});

/**
 * Listen for storage changes to handle login/logout
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.userData) {
    if (changes.userData.newValue) {
      // User logged in - initialize outbox model with all user relays
      getOutboxModel().initialize().catch(console.error);
    } else {
      // User logged out - disconnect all relay connections
      getOutboxModel().disconnect();
    }
  }
});

// Initialize outbox model and inbox scanner on startup if user is logged in
Database.getUserData().then(userData => {
  if (userData) {
    console.log('[Background] User logged in, initializing services');
    getOutboxModel().initialize().catch(console.error);
    getInboxScanner().initialize().catch(console.error);
  } else {
    console.log('[Background] No user logged in, skipping service initialization');
  }
}).catch(console.error);


// =============================================================================
// Message Router
// =============================================================================

/**
 * Listen for messages from popup or content scripts
 * Firefox-compatible version that returns Promises
 */
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: MessageResponse) => void) => {
    // Handle message and return promise for Firefox compatibility
    const handleMessage = async (): Promise<MessageResponse> => {
      try {
        switch (message.type) {
          // Simple sync responses
          case MessageType.PING:
            return { success: true, data: 'pong' };

          case MessageType.NOTIFY:
            console.log('Notification:', message.payload);
            return { success: true };

          // Authentication handlers
          case MessageType.GET_LOGIN_STATUS: {
            const data = await handleGetLoginStatus();
            return { success: true, data };
          }

          case MessageType.SIMPLE_LOGIN: {
            const data = await handleSimpleLogin(message.payload);
            return { success: true, data };
          }

          case MessageType.LOGOUT:
            await handleLogout();
            return { success: true };

          // User data handlers
          case MessageType.FETCH_USER_DATA: {
            const data = await handleFetchUserData();
            return { success: true, data };
          }

          case MessageType.REFRESH_DATA: {
            const data = await handleRefreshData();
            return { success: true, data };
          }

          // Contact handlers
          case MessageType.FETCH_CONTACTS: {
            const data = await handleFetchContacts();
            return { success: true, data };
          }

          // Relay management handlers
          case MessageType.FETCH_RELAYS: {
            const data = await handleFetchRelays();
            return { success: true, data };
          }

          // Outbox model handlers
          case MessageType.GET_OUTBOX_MODEL_EVENTS: {
            const data = await handleGetOutboxModelEvents();
            return { success: true, data };
          }

          case MessageType.GET_OUTBOX_MODEL_STATUS: {
            const data = await handleGetOutboxModelStatus();
            return { success: true, data };
          }

          case MessageType.CONNECT_OUTBOX_MODEL:
            await handleConnectOutboxModel();
            return { success: true };

          case MessageType.DISCONNECT_OUTBOX_MODEL:
            await handleDisconnectOutboxModel();
            return { success: true };

          // Inbox scanner handlers
          case MessageType.GET_INBOX_SCANNER_STATUS: {
            const data = await handleGetInboxScannerStatus();
            return { success: true, data };
          }

          case MessageType.GET_INBOX_SCANNER_EVENTS: {
            const data = await handleGetInboxScannerEvents();
            return { success: true, data };
          }

          case MessageType.TRIGGER_INBOX_SCAN: {
            const data = await handleTriggerInboxScan();
            return { success: true, data };
          }

          case MessageType.STOP_INBOX_SCAN:
            await handleStopInboxScan();
            return { success: true };

          case MessageType.TOGGLE_INBOX_SCANNER: {
            const data = await handleToggleInboxScanner();
            return { success: true, data };
          }

          // Storage handlers
          case MessageType.GET_DATA: {
            const data = await handleGetData(message.payload);
            return { success: true, data };
          }

          case MessageType.SET_DATA:
            await handleSetData(message.payload);
            return { success: true };

          default:
            return { success: false, error: 'Unknown message type' };
        }
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        };
      }
    };

    // Execute handler and send response
    handleMessage()
      .then(response => {
        sendResponse(response);
      })
      .catch(error => {
        console.error('Error handling message:', error);
        sendResponse({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      });

    // Return true to indicate async response
    return true;
  }
);

// =============================================================================
// Authentication Handlers
// =============================================================================

/**
 * Get login status
 */
async function handleGetLoginStatus(): Promise<{ isLoggedIn: boolean; userData: UserData | null }> {
  const isLoggedIn = await Database.isLoggedIn();
  const userData = await Database.getUserData();
  return { isLoggedIn, userData };
}

/**
 * Handle simple login with npub, pubkey, or NIP-05
 */
async function handleSimpleLogin(payload: { identifier: string }): Promise<UserData> {
  const { identifier } = payload;
  
  let pubkey: string;
  
  // Detect identifier type and convert to hex pubkey
  if (identifier.startsWith('npub1')) {
    // Convert npub to hex using nostr-tools
    const { nip19 } = await import('nostr-tools');
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type !== 'npub') {
        throw new Error('Invalid npub format');
      }
      pubkey = decoded.data;
    } catch (error) {
      throw new Error('Invalid npub format. Please check the npub and try again.');
    }
  } else if (identifier.includes('@')) {
    // NIP-05 address
    pubkey = await resolveNip05(identifier);
  } else if (/^[0-9a-f]{64}$/i.test(identifier)) {
    // Hex pubkey
    pubkey = identifier.toLowerCase();
  } else {
    throw new Error('Invalid identifier. Please provide a valid npub, pubkey (hex), or NIP-05 address.');
  }

  // Initialize relay manager with default relays
  const rm = await getRelayManager();

  // Try to fetch user's relay list (NIP-65)
  const relayListManager = new RelayListManager(rm);
  const relayMetadata = await relayListManager.fetchRelayList(pubkey);
  
  let relayUrls: string[] = [];
  if (relayMetadata.length > 0) {
    relayUrls = relayMetadata.map(r => r.url);
    rm.setRelays(relayUrls);
  } else {
    // Use default relays if no relay list found
    relayUrls = rm.getRelays();
  }

  // Create initial user data
  const userData: UserData = {
    pubkey,
    contacts: [],
    relays: relayUrls,
    relayMetadata,
    lastUpdated: Date.now(),
  };
  await Database.setUserData(userData);

  // Ensure first login timestamp is set (only happens once)
  await Database.ensureFirstLoginTimestamp();

  // Fetch user profile and contacts in background
  fetchUserDataInBackground(pubkey);

  return userData;
}

/**
 * Logout user
 */
async function handleLogout(): Promise<void> {
  await Database.clear();
  if (relayManager) {
    relayManager.close();
    relayManager = null;
  }
}

// =============================================================================
// User Data Handlers
// =============================================================================

/**
 * Fetch user data in background (async, non-blocking)
 */
async function fetchUserDataInBackground(pubkey: string): Promise<void> {
  try {
    const rm = await getRelayManager();
    const profileManager = new ProfileManager(rm);
    const contactsManager = new ContactsManager(rm);

    await profileManager.fetchUserProfile(pubkey);

    const contacts = await contactsManager.fetchContacts(pubkey);

    if (contacts.length > 0) {
      const pubkeys = contacts.map(c => c.pubkey);
      await profileManager.fetchProfiles(pubkeys);
    }

    console.log('User data fetched successfully');
  } catch (error) {
    console.error('Error fetching user data in background:', error);
  }
}

/**
 * Fetch fresh user data
 */
async function handleFetchUserData(): Promise<UserData> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const profileManager = new ProfileManager(rm);
  const contactsManager = new ContactsManager(rm);

  await profileManager.fetchUserProfile(userData.pubkey);

  const contacts = await contactsManager.fetchContacts(userData.pubkey);

  if (contacts.length > 0) {
    const pubkeys = contacts.map(c => c.pubkey);
    await profileManager.fetchProfiles(pubkeys);
  }

  return await Database.getUserData() as UserData;
}

/**
 * Refresh all data (profile, contacts, relays) without fetching secondary data
 * This fetches only the main events: kind 0 (profile), kind 3 (contacts), kind 10002 (relays)
 * Does NOT fetch contact profiles or relay metadata (NIP-11)
 */
async function handleRefreshData(): Promise<UserData> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const profileManager = new ProfileManager(rm);
  const contactsManager = new ContactsManager(rm);
  const relayListManager = new RelayListManager(rm);

  await Promise.all([
    profileManager.fetchUserProfile(userData.pubkey),
    contactsManager.fetchContacts(userData.pubkey),
    relayListManager.fetchRelayList(userData.pubkey),
  ]);

  return await Database.getUserData() as UserData;
}

// =============================================================================
// Contact Handlers
// =============================================================================

/**
 * Fetch contacts with profiles
 */
async function handleFetchContacts(): Promise<any> {
  return await Database.getContactsWithProfiles();
}

/**
 * Resolve NIP-05 identifier to pubkey
 */
async function resolveNip05(identifier: string): Promise<string> {
  const [name, domain] = identifier.split('@');
  if (!name || !domain) {
    throw new Error('Invalid NIP-05 format. Expected: name@domain.com');
  }
  
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
  
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.names || !data.names[name]) {
      throw new Error(`No pubkey found for ${identifier}`);
    }
    
    return data.names[name];
  } catch (error) {
    console.error('NIP-05 resolution error:', error);
    throw new Error(`Failed to resolve NIP-05 identifier: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// =============================================================================
// Relay Management Handlers
// =============================================================================

/**
 * Fetch relay list (returns cached data immediately, fetches NIP-11 in background)
 */
async function handleFetchRelays(): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const relayList = await relayListManager.fetchRelayList(userData.pubkey);
  
  // Fetch NIP-11 information in the background (non-blocking)
  fetchRelayInfoInBackground(relayList).catch(error => {
    console.error('Error fetching relay info in background:', error);
  });
  
  return relayList;
}

/**
 * Fetch NIP-11 relay information in background
 */
async function fetchRelayInfoInBackground(relayList: RelayMetadata[]): Promise<void> {
  const relaysToFetch = relayList.filter(relay => !relay.info);
  
  if (relaysToFetch.length === 0) {
    console.log('[NIP-11] All relays already have info cached');
    return;
  }
  
  console.log(`[NIP-11] Fetching info for ${relaysToFetch.length} relays in background`);
  
  const relayUrls = relaysToFetch.map(r => r.url);
  const relayInfoMap = await fetchRelayInfoBatch(relayUrls, 5000);
  
  const updatedRelayList = relayList.map(relay => ({
    ...relay,
    info: relayInfoMap.get(relay.url) || relay.info,
  }));
  
  await Database.updateUserRelayMetadata(updatedRelayList);
  
  console.log(`[NIP-11] Successfully updated ${relayInfoMap.size} relays with info`);
}


// =============================================================================
// Outbox Model Handlers
// =============================================================================

/**
 * Handle connect outbox model request (now auto-connects to all user relays)
 */
async function handleConnectOutboxModel(): Promise<void> {
  await getOutboxModel().initialize();
}

/**
 * Handle disconnect outbox model request
 */
async function handleDisconnectOutboxModel(): Promise<void> {
  getOutboxModel().disconnect();
}

/**
 * Handle get outbox model events request
 */
async function handleGetOutboxModelEvents(): Promise<Array<NostrEvent & { relayCount: number }>> {
  const outboxModel = getOutboxModel();
  const events = outboxModel.getEvents();
  
  // Add relay count to each event
  return events.map(event => ({
    ...event,
    relayCount: outboxModel.getRelayCount(event.id)
  }));
}

/**
 * Handle get outbox model status request
 */
async function handleGetOutboxModelStatus(): Promise<any> {
  return getOutboxModel().getStatus();
}

// =============================================================================
// Inbox Scanner Handlers
// =============================================================================

/**
 * Handle get inbox scanner status request
 */
async function handleGetInboxScannerStatus(): Promise<any> {
  return await getInboxScanner().getStatus();
}

/**
 * Handle get inbox scanner events request
 */
async function handleGetInboxScannerEvents(): Promise<any> {
  return await getInboxScanner().getDiscoveredEvents();
}

/**
 * Handle trigger inbox scan request
 */
async function handleTriggerInboxScan(): Promise<any> {
  return await getInboxScanner().performScan();
}

/**
 * Handle stop inbox scan request
 */
async function handleStopInboxScan(): Promise<void> {
  await getInboxScanner().stopScan();
}

/**
 * Handle toggle inbox scanner request
 */
async function handleToggleInboxScanner(): Promise<boolean> {
  return await getInboxScanner().toggleEnabled();
}

// =============================================================================
// Storage Handlers
// =============================================================================

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
