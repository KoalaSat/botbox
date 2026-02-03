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

// Inline types and enums to avoid code splitting
enum MessageType {
  PING = 'PING',
  GET_DATA = 'GET_DATA',
  SET_DATA = 'SET_DATA',
  NOTIFY = 'NOTIFY',
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

// Global relay manager instance
let relayManager: RelayManager | null = null;

/**
 * Get or create relay manager with user's relays if available
 */
async function getRelayManager(): Promise<RelayManager> {
  if (!relayManager) {
    // Try to get user's relays from database
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

      case MessageType.GET_LOGIN_STATUS:
        handleGetLoginStatus()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.CONNECT_NIP07:
        handleConnectNip07()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.NIP07_LOGIN:
        handleNip07Login(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.FETCH_USER_DATA:
        handleFetchUserData()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.FETCH_CONTACTS:
        handleFetchContacts()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.REMOVE_CONTACT:
        handleRemoveContact(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.ADD_CONTACT:
        handleAddContact(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.LOGOUT:
        handleLogout()
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.FETCH_RELAYS:
        handleFetchRelays()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.ADD_RELAY:
        handleAddRelay(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.REMOVE_RELAY:
        handleRemoveRelay(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.UPDATE_RELAY_TYPE:
        handleUpdateRelayType(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.PUBLISH_RELAY_LIST:
        handlePublishRelayList()
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.REFRESH_DATA:
        handleRefreshData()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.GET_DATA:
        handleGetData(message.payload)
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.SET_DATA:
        handleSetData(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

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
 * Get login status
 */
async function handleGetLoginStatus(): Promise<{ isLoggedIn: boolean; userData: UserData | null }> {
  const isLoggedIn = await Database.isLoggedIn();
  const userData = await Database.getUserData();
  return { isLoggedIn, userData };
}

/**
 * Handle NIP-07 connection via tab injection
 * This fetches the pubkey and relays from window.nostr in a suitable tab
 * Will automatically create a helper tab if needed
 */
async function handleConnectNip07(): Promise<{ pubkey: string; relays: Record<string, { read: boolean; write: boolean }> | null }> {
  // Ensure we have a suitable tab (will create helper if needed)
  await Nip07TabService.ensureHelperTab();
  
  // Wait for NIP-07 provider to be available
  const hasProvider = await Nip07TabService.waitForProvider(5000, true);
  if (!hasProvider) {
    throw new Error('NIP-07 provider not found. Please install a Nostr extension like Alby or nos2x.');
  }

  // Get public key
  const pubkey = await Nip07TabService.getPublicKey();
  
  // Get relays if available
  const relays = await Nip07TabService.getRelays();

  return { pubkey, relays };
}

/**
 * Handle NIP-07 login
 */
async function handleNip07Login(payload: { pubkey: string; relays?: Record<string, { read: boolean; write: boolean }> | null }): Promise<UserData> {
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
 * Fetch user data in background (async, non-blocking)
 */
async function fetchUserDataInBackground(pubkey: string): Promise<void> {
  try {
    const rm = await getRelayManager();
    const profileManager = new ProfileManager(rm);
    const contactsManager = new ContactsManager(rm);

    // Fetch profile
    await profileManager.fetchUserProfile(pubkey);

    // Fetch contacts
    const contacts = await contactsManager.fetchContacts(pubkey);

    // Fetch contact profiles
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

  // Fetch profile
  await profileManager.fetchUserProfile(userData.pubkey);

  // Fetch contacts
  const contacts = await contactsManager.fetchContacts(userData.pubkey);

  // Fetch contact profiles
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

  // Fetch all data in parallel for better performance
  await Promise.all([
    // Fetch user profile (kind 0)
    profileManager.fetchUserProfile(userData.pubkey),
    
    // Fetch contacts list (kind 3) - just the pubkeys, no profile fetching
    contactsManager.fetchContacts(userData.pubkey),
    
    // Fetch relay list (kind 10002) - just URLs and types, no NIP-11 fetching
    relayListManager.fetchRelayList(userData.pubkey),
  ]);

  // Return updated user data
  return await Database.getUserData() as UserData;
}

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
      headers: {
        'Accept': 'application/json',
      },
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

/**
 * Add a contact - supports pubkey (hex) or nip05
 * Note: npub decoding is handled in the frontend (browser context)
 */
async function handleAddContact(payload: { identifier: string }): Promise<void> {
  const { identifier } = payload;
  
  let pubkey: string;
  
  // Determine the type of identifier and convert to pubkey
  if (identifier.includes('@')) {
    // It's a NIP-05 identifier - resolve it
    pubkey = await resolveNip05(identifier);
  } else if (/^[0-9a-f]{64}$/i.test(identifier)) {
    // It's a hex pubkey
    pubkey = identifier.toLowerCase();
  } else {
    throw new Error('Invalid identifier. Please provide a valid pubkey (hex) or NIP-05 address.');
  }
  
  // Add the contact
  const rm = await getRelayManager();
  const contactsManager = new ContactsManager(rm);
  const profileManager = new ProfileManager(rm);
  
  await contactsManager.addContact({
    pubkey,
  });
  
  // Fetch the profile for the new contact in background
  profileManager.fetchProfiles([pubkey]).catch(error => {
    console.error('Error fetching profile for new contact:', error);
  });
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
 * Fetch relay list (returns cached data immediately, fetches NIP-11 in background)
 */
async function handleFetchRelays(): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  // Get relay list from Nostr or local storage
  let relayList = await relayListManager.fetchRelayList(userData.pubkey);
  
  // Fetch NIP-11 information in the background (non-blocking)
  fetchRelayInfoInBackground(relayList).catch(error => {
    console.error('Error fetching relay info in background:', error);
  });
  
  // Return immediately with cached data (may include previously fetched NIP-11 info)
  return relayList;
}

/**
 * Fetch NIP-11 relay information in background
 */
async function fetchRelayInfoInBackground(relayList: RelayMetadata[]): Promise<void> {
  // Only fetch for relays that don't have info yet or need refresh
  const relaysToFetch = relayList.filter(relay => !relay.info);
  
  if (relaysToFetch.length === 0) {
    console.log('[NIP-11] All relays already have info cached');
    return;
  }
  
  console.log(`[NIP-11] Fetching info for ${relaysToFetch.length} relays in background`);
  
  const relayUrls = relaysToFetch.map(r => r.url);
  const relayInfoMap = await fetchRelayInfoBatch(relayUrls, 5000);
  
  // Merge NIP-11 info into relay metadata
  const updatedRelayList = relayList.map(relay => ({
    ...relay,
    info: relayInfoMap.get(relay.url) || relay.info,
  }));
  
  // Update database with the enriched relay info
  await Database.updateUserRelayMetadata(updatedRelayList);
  
  console.log(`[NIP-11] Successfully updated ${relayInfoMap.size} relays with info`);
}

/**
 * Add a relay
 */
async function handleAddRelay(payload: { url: string; type: 'read' | 'write' | 'both' }): Promise<RelayMetadata[]> {
  const userData = await Database.getUserData();
  if (!userData) {
    throw new Error('User not logged in');
  }

  const rm = await getRelayManager();
  const relayListManager = new RelayListManager(rm);

  const updatedRelays = await relayListManager.addRelay(payload.url, payload.type);
  
  // Update relay manager to use the new relay list
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
  
  // Update relay manager to use the new relay list
  const allRelayUrls = updatedRelays.map(r => r.url);
  rm.setRelays(allRelayUrls);

  return updatedRelays;
}

/**
 * Update relay type
 */
async function handleUpdateRelayType(payload: { url: string; type: 'read' | 'write' | 'both' }): Promise<RelayMetadata[]> {
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

  // Get current relay list
  const relayList = await relayListManager.getRelayList();

  // Sign event using NIP-07
  const signEvent = async (event: any) => {
    return await Nip07TabService.signEvent(event);
  };

  // Publish the relay list
  await relayListManager.publishRelayList(relayList, signEvent);
}
