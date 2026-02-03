/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and Nostr operations
 */

import { RelayManager } from '../services/relayManager';
import { ContactsManager } from '../services/contactsManager';
import { ProfileManager } from '../services/profileManager';
import { RelayListManager } from '../services/relayListManager';
import { Database, type UserData, type RelayMetadata } from '../services/db';
import { Nip07TabService } from '../services/nip07Tab';
import { fetchRelayInfoBatch } from '../services/nip11';
import { ConsistencyRelayService } from '../services/consistencyRelay';
import {
  handleAsync,
  handleAsyncWithPayload,
  handleAsyncVoid,
  handleAsyncVoidWithPayload,
} from './messageHandler';
import type { Event as NostrEvent } from 'nostr-tools';

// =============================================================================
// Types and Enums
// =============================================================================

enum MessageType {
  PING = 'PING',
  GET_DATA = 'GET_DATA',
  SET_DATA = 'SET_DATA',
  NOTIFY = 'NOTIFY',
  
  // Authentication
  CONNECT_NIP07 = 'CONNECT_NIP07',
  NIP07_LOGIN = 'NIP07_LOGIN',
  LOGOUT = 'LOGOUT',
  GET_LOGIN_STATUS = 'GET_LOGIN_STATUS',
  
  // User Data
  FETCH_USER_DATA = 'FETCH_USER_DATA',
  REFRESH_DATA = 'REFRESH_DATA',
  
  // Contacts
  FETCH_CONTACTS = 'FETCH_CONTACTS',
  REMOVE_CONTACT = 'REMOVE_CONTACT',
  ADD_CONTACT = 'ADD_CONTACT',
  
  // Relay Management (NIP-65)
  FETCH_RELAYS = 'FETCH_RELAYS',
  ADD_RELAY = 'ADD_RELAY',
  REMOVE_RELAY = 'REMOVE_RELAY',
  UPDATE_RELAY_TYPE = 'UPDATE_RELAY_TYPE',
  PUBLISH_RELAY_LIST = 'PUBLISH_RELAY_LIST',
  
  // Consistency Relay
  GET_CONSISTENCY_RELAY_EVENTS = 'GET_CONSISTENCY_RELAY_EVENTS',
  GET_CONSISTENCY_RELAY_STATUS = 'GET_CONSISTENCY_RELAY_STATUS',
  CONNECT_CONSISTENCY_RELAY = 'CONNECT_CONSISTENCY_RELAY',
  DISCONNECT_CONSISTENCY_RELAY = 'DISCONNECT_CONSISTENCY_RELAY',
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

// =============================================================================
// Global State
// =============================================================================

console.log('Background service worker initialized');

let relayManager: RelayManager | null = null;
let consistencyRelay: ConsistencyRelayService | null = null;

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
// Consistency Relay
// =============================================================================

/**
 * Get or create consistency relay service
 */
function getConsistencyRelay(): ConsistencyRelayService {
  if (!consistencyRelay) {
    consistencyRelay = new ConsistencyRelayService(getRelayManager);
  }
  return consistencyRelay;
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
 * Listen for storage changes to handle login/logout and consistency relay
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.userData) {
    if (changes.userData.newValue) {
      getConsistencyRelay().initialize().catch(console.error);
    } else {
      getConsistencyRelay().disconnect();
    }
  }
  
  if (areaName === 'local' && changes.consistencyRelayUrl) {
    if (changes.consistencyRelayUrl.newValue) {
      getConsistencyRelay().initialize().catch(console.error);
    } else {
      getConsistencyRelay().disconnect();
    }
  }
});

// Initialize consistency relay on startup if user is logged in
getConsistencyRelay().initialize().catch(console.error);

// =============================================================================
// Message Router
// =============================================================================

/**
 * Listen for messages from popup or content scripts
 */
chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (response: MessageResponse) => void) => {
    console.log('Background received message:', message, 'from:', sender);

    switch (message.type) {
      // Simple sync responses
      case MessageType.PING:
        sendResponse({ success: true, data: 'pong' });
        break;

      case MessageType.NOTIFY:
        console.log('Notification:', message.payload);
        sendResponse({ success: true });
        break;

      // Authentication handlers
      case MessageType.GET_LOGIN_STATUS:
        return handleAsync(handleGetLoginStatus, sendResponse);

      case MessageType.CONNECT_NIP07:
        return handleAsync(handleConnectNip07, sendResponse);

      case MessageType.NIP07_LOGIN:
        return handleAsyncWithPayload(handleNip07Login, message.payload, sendResponse);

      case MessageType.LOGOUT:
        return handleAsyncVoid(handleLogout, sendResponse);

      // User data handlers
      case MessageType.FETCH_USER_DATA:
        return handleAsync(handleFetchUserData, sendResponse);

      case MessageType.REFRESH_DATA:
        return handleAsync(handleRefreshData, sendResponse);

      // Contact handlers
      case MessageType.FETCH_CONTACTS:
        return handleAsync(handleFetchContacts, sendResponse);

      case MessageType.REMOVE_CONTACT:
        return handleAsyncVoidWithPayload(handleRemoveContact, message.payload, sendResponse);

      case MessageType.ADD_CONTACT:
        return handleAsyncVoidWithPayload(handleAddContact, message.payload, sendResponse);

      // Relay management handlers
      case MessageType.FETCH_RELAYS:
        return handleAsync(handleFetchRelays, sendResponse);

      case MessageType.ADD_RELAY:
        return handleAsyncWithPayload(handleAddRelay, message.payload, sendResponse);

      case MessageType.REMOVE_RELAY:
        return handleAsyncWithPayload(handleRemoveRelay, message.payload, sendResponse);

      case MessageType.UPDATE_RELAY_TYPE:
        return handleAsyncWithPayload(handleUpdateRelayType, message.payload, sendResponse);

      case MessageType.PUBLISH_RELAY_LIST:
        return handleAsyncVoid(handlePublishRelayList, sendResponse);

      // Consistency relay handlers
      case MessageType.GET_CONSISTENCY_RELAY_EVENTS:
        return handleAsync(handleGetConsistencyRelayEvents, sendResponse);

      case MessageType.GET_CONSISTENCY_RELAY_STATUS:
        return handleAsync(handleGetConsistencyRelayStatus, sendResponse);

      case MessageType.CONNECT_CONSISTENCY_RELAY:
        return handleAsyncVoid(handleConnectConsistencyRelay, sendResponse);

      case MessageType.DISCONNECT_CONSISTENCY_RELAY:
        return handleAsyncVoid(handleDisconnectConsistencyRelay, sendResponse);

      // Storage handlers
      case MessageType.GET_DATA:
        return handleAsyncWithPayload(handleGetData, message.payload, sendResponse);

      case MessageType.SET_DATA:
        return handleAsyncVoidWithPayload(handleSetData, message.payload, sendResponse);

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
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
 * Handle NIP-07 connection via tab injection
 */
async function handleConnectNip07(): Promise<{ 
  pubkey: string; 
  relays: Record<string, { read: boolean; write: boolean }> | null 
}> {
  await Nip07TabService.ensureHelperTab();
  
  const hasProvider = await Nip07TabService.waitForProvider(5000, true);
  if (!hasProvider) {
    throw new Error('NIP-07 provider not found. Please install a Nostr extension like Alby or nos2x.');
  }

  const pubkey = await Nip07TabService.getPublicKey();
  const relays = await Nip07TabService.getRelays();

  return { pubkey, relays };
}

/**
 * Handle NIP-07 login
 */
async function handleNip07Login(payload: { 
  pubkey: string; 
  relays?: Record<string, { read: boolean; write: boolean }> | null 
}): Promise<UserData> {
  const { pubkey, relays: nip07Relays } = payload;

  // Extract relay URLs from NIP-07 relays
  let relayUrls: string[] = [];
  if (nip07Relays) {
    relayUrls = Object.entries(nip07Relays)
      .filter(([_, config]) => config.read || config.write)
      .map(([url, _]) => url);
  }

  // Initialize relay manager with user's relays if available
  const rm = await getRelayManager();
  if (relayUrls.length > 0) {
    rm.addRelays(relayUrls);
  }

  // Try to fetch user's relay list (NIP-65)
  const contactsManager = new ContactsManager(rm);
  const userRelays = await contactsManager.fetchUserRelays(pubkey);
  if (userRelays.length > 0) {
    rm.addRelays(userRelays);
    relayUrls = [...new Set([...relayUrls, ...userRelays])];
  }

  // Create initial user data
  const userData: UserData = {
    pubkey,
    contacts: [],
    relays: relayUrls,
    lastUpdated: Date.now(),
  };

  await Database.setUserData(userData);

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
 * Remove a contact
 */
async function handleRemoveContact(payload: { pubkey: string }): Promise<void> {
  const rm = await getRelayManager();
  const contactsManager = new ContactsManager(rm);
  await contactsManager.removeContact(payload.pubkey);
}

/**
 * Add a contact - supports pubkey (hex) or nip05
 */
async function handleAddContact(payload: { identifier: string }): Promise<void> {
  const { identifier } = payload;
  
  let pubkey: string;
  
  if (identifier.includes('@')) {
    pubkey = await resolveNip05(identifier);
  } else if (/^[0-9a-f]{64}$/i.test(identifier)) {
    pubkey = identifier.toLowerCase();
  } else {
    throw new Error('Invalid identifier. Please provide a valid pubkey (hex) or NIP-05 address.');
  }
  
  const rm = await getRelayManager();
  const contactsManager = new ContactsManager(rm);
  const profileManager = new ProfileManager(rm);
  
  await contactsManager.addContact({ pubkey });
  
  // Fetch the profile for the new contact in background
  profileManager.fetchProfiles([pubkey]).catch(error => {
    console.error('Error fetching profile for new contact:', error);
  });
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

/**
 * Add a relay
 */
async function handleAddRelay(payload: { 
  url: string; 
  type: 'read' | 'write' | 'both' 
}): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const updatedRelays = await relayListManager.addRelay(payload.url, payload.type);
  
  const allRelayUrls = updatedRelays.map(r => r.url);
  rm.setRelays(allRelayUrls);

  return updatedRelays;
}

/**
 * Remove a relay
 */
async function handleRemoveRelay(payload: { url: string }): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const updatedRelays = await relayListManager.removeRelay(payload.url);
  
  const allRelayUrls = updatedRelays.map(r => r.url);
  rm.setRelays(allRelayUrls);

  return updatedRelays;
}

/**
 * Update relay type
 */
async function handleUpdateRelayType(payload: { 
  url: string; 
  type: 'read' | 'write' | 'both' 
}): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const updatedRelays = await relayListManager.updateRelayType(payload.url, payload.type);
  return updatedRelays;
}

/**
 * Publish relay list to Nostr (NIP-65)
 */
async function handlePublishRelayList(): Promise<void> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const relayList = await relayListManager.getRelayList();

  const signEvent = async (event: any) => {
    return await Nip07TabService.signEvent(event);
  };

  await relayListManager.publishRelayList(relayList, signEvent);
}

// =============================================================================
// Consistency Relay Handlers
// =============================================================================

/**
 * Handle connect consistency relay request
 */
async function handleConnectConsistencyRelay(): Promise<void> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const relayUrl = await Database.getConsistencyRelayUrl();
  if (!relayUrl) {
    throw new Error('Consistency relay not configured');
  }

  await getConsistencyRelay().connect(relayUrl, userData.pubkey);
}

/**
 * Handle disconnect consistency relay request
 */
async function handleDisconnectConsistencyRelay(): Promise<void> {
  getConsistencyRelay().disconnect();
}

/**
 * Handle get consistency relay events request
 */
async function handleGetConsistencyRelayEvents(): Promise<NostrEvent[]> {
  return getConsistencyRelay().getEvents();
}

/**
 * Handle get consistency relay status request
 */
async function handleGetConsistencyRelayStatus(): Promise<{ 
  connected: boolean; 
  url: string | null; 
  reconnectAttempts: number 
}> {
  return getConsistencyRelay().getStatus();
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
