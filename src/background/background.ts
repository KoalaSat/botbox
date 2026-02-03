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
import type { Event as NostrEvent, Filter } from 'nostr-tools';

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
  
  // Consistency relay events
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

      case MessageType.GET_CONSISTENCY_RELAY_EVENTS:
        handleGetConsistencyRelayEvents()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.GET_CONSISTENCY_RELAY_STATUS:
        handleGetConsistencyRelayStatus()
          .then((data) => sendResponse({ success: true, data }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.CONNECT_CONSISTENCY_RELAY:
        handleConnectConsistencyRelay()
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;

      case MessageType.DISCONNECT_CONSISTENCY_RELAY:
        handleDisconnectConsistencyRelay()
          .then(() => sendResponse({ success: true }))
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

/**
 * Consistency Relay Management
 */

// Store for consistency relay
let consistencyRelayWs: WebSocket | null = null;
let consistencyRelayEvents: NostrEvent[] = [];
let consistencyRelayUrl: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Initialize consistency relay connection on startup
 */
async function initializeConsistencyRelay(): Promise<void> {
  const userData = await Database.getUserData();
  if (!userData) {
    return; // Not logged in yet
  }

  const relayUrl = await Database.getConsistencyRelayUrl();
  if (relayUrl) {
    console.log('[ConsistencyRelay] Auto-connecting to:', relayUrl);
    await connectToConsistencyRelay(relayUrl, userData.pubkey);
  }
}

/**
 * Connect to consistency relay
 */
async function connectToConsistencyRelay(url: string, pubkey: string): Promise<void> {
  // Close existing connection if any
  if (consistencyRelayWs) {
    consistencyRelayWs.close();
    consistencyRelayWs = null;
  }

  consistencyRelayUrl = url;
  
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('[ConsistencyRelay] Connected to:', url);
        consistencyRelayWs = ws;
        reconnectAttempts = 0;
        
        // Subscribe to user's events
        const subscriptionId = 'consistency-relay-' + Date.now();
        const filter = { authors: [pubkey] };
        const req = JSON.stringify(['REQ', subscriptionId, filter]);
        ws.send(req);
        
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleConsistencyRelayMessage(message);
        } catch (err) {
          console.error('[ConsistencyRelay] Error parsing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[ConsistencyRelay] WebSocket error:', err);
        reject(new Error('Failed to connect to consistency relay'));
      };

      ws.onclose = () => {
        console.log('[ConsistencyRelay] Disconnected');
        consistencyRelayWs = null;
        
        // Auto-reconnect if not manually disconnected
        if (consistencyRelayUrl && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`[ConsistencyRelay] Reconnecting attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
          setTimeout(async () => {
            const userData = await Database.getUserData();
            if (userData && consistencyRelayUrl) {
              await connectToConsistencyRelay(consistencyRelayUrl, userData.pubkey).catch(console.error);
            }
          }, RECONNECT_DELAY);
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Extract pubkeys from event tags (p tags)
 */
function extractTaggedPubkeys(event: NostrEvent): string[] {
  const pubkeys: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'p' && tag[1]) {
      pubkeys.push(tag[1]);
    }
  }
  return pubkeys;
}

/**
 * Broadcast event to user's outbox relays and tagged users' inbox relays
 * Uses direct WebSocket connections to capture detailed relay responses
 */
async function broadcastEventToOutboxAndInbox(event: NostrEvent): Promise<void> {
  try {
    console.log('[ConsistencyRelay] Broadcasting event', event.id.substring(0, 8), 'kind:', event.kind);
    
    const userData = await Database.getUserData();
    if (!userData) {
      console.warn('[ConsistencyRelay] No user data, cannot broadcast');
      return;
    }

    const rm = await getRelayManager();
    const relayListManager = new RelayListManager(rm);
    
    // Get user's outbox relays (write relays)
    const outboxRelays = await relayListManager.getWriteRelays();
    console.log('[ConsistencyRelay] User outbox relays:', outboxRelays.length);
    
    // Extract tagged pubkeys
    const taggedPubkeys = extractTaggedPubkeys(event);
    console.log('[ConsistencyRelay] Tagged pubkeys:', taggedPubkeys.length);
    
    // Collect all inbox relays for tagged pubkeys
    const inboxRelaysSet = new Set<string>();
    
    if (taggedPubkeys.length > 0) {
      // Fetch relay lists for tagged pubkeys in parallel
      const relayListPromises = taggedPubkeys.map(async (pubkey) => {
        try {
          // Fetch relay list with network skip for faster response
          const relayMetadata = await relayListManager.fetchRelayList(pubkey, true);
          // Get read relays (inbox)
          const readRelays = relayMetadata
            .filter(r => r.type === 'read' || r.type === 'both')
            .map(r => r.url);
          return readRelays;
        } catch (error) {
          console.warn('[ConsistencyRelay] Failed to fetch relay list for', pubkey.substring(0, 8), ':', error);
          return [];
        }
      });
      
      const allInboxRelays = await Promise.all(relayListPromises);
      
      // Flatten and deduplicate
      allInboxRelays.forEach(relays => {
        relays.forEach(relay => inboxRelaysSet.add(relay));
      });
    }
    
    const inboxRelays = Array.from(inboxRelaysSet);
    console.log('[ConsistencyRelay] Tagged users inbox relays:', inboxRelays.length);
    
    // Combine and deduplicate all target relays
    let allTargetRelays = [...new Set([...outboxRelays, ...inboxRelays])];
    
    // Exclude the consistency relay itself (we're receiving FROM it, not sending TO it)
    if (consistencyRelayUrl) {
      const beforeCount = allTargetRelays.length;
      allTargetRelays = allTargetRelays.filter(url => url !== consistencyRelayUrl);
      if (beforeCount !== allTargetRelays.length) {
        console.log('[ConsistencyRelay] Excluded consistency relay from broadcast targets');
      }
    }
    
    console.log('[ConsistencyRelay] Total target relays (deduplicated):', allTargetRelays.length);
    
    if (allTargetRelays.length === 0) {
      console.warn('[ConsistencyRelay] No target relays found, cannot broadcast');
      return;
    }
    
    // Broadcast to each relay individually to capture detailed responses
    const broadcastPromises = allTargetRelays.map(relayUrl => 
      broadcastToSingleRelay(relayUrl, event)
    );
    
    const results = await Promise.allSettled(broadcastPromises);
    
    let successCount = 0;
    let duplicateCount = 0;
    let failureCount = 0;
    
    results.forEach((result, index) => {
      const relayUrl = allTargetRelays[index];
      if (result.status === 'fulfilled') {
        const response = result.value;
        if (response.success) {
          successCount++;
          if (response.duplicate) {
            duplicateCount++;
            console.log(`[ConsistencyRelay] ℹ ${relayUrl} already had the event`);
          }
        } else {
          failureCount++;
        }
      } else {
        failureCount++;
        console.error(`[ConsistencyRelay] ✗ Failed to broadcast to ${relayUrl}:`, result.reason);
      }
    });
    
    console.log(`[ConsistencyRelay] Broadcast complete: ${successCount} succeeded, ${duplicateCount} duplicates, ${failureCount} failed`);
    
  } catch (error) {
    console.error('[ConsistencyRelay] Error broadcasting event:', error);
  }
}

/**
 * Broadcast event to a single relay and capture the OK response
 */
async function broadcastToSingleRelay(relayUrl: string, event: NostrEvent): Promise<{ success: boolean; duplicate: boolean; message?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, duplicate: false, message: 'Timeout' });
    }, 5000);

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
    } catch (error) {
      clearTimeout(timeout);
      resolve({ success: false, duplicate: false, message: `Connection error: ${error}` });
      return;
    }

    ws.onopen = () => {
      // Send EVENT message
      const eventMessage = JSON.stringify(['EVENT', event]);
      ws.send(eventMessage);
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        const [type, eventId, accepted, message] = data;
        
        // NIP-20: OK messages
        if (type === 'OK' && eventId === event.id) {
          clearTimeout(timeout);
          ws.close();
          
          if (accepted) {
            // Check if the message indicates the event already existed
            const isDuplicate = message && (
              message.toLowerCase().includes('duplicate') ||
              message.toLowerCase().includes('already have') ||
              message.toLowerCase().includes('already exists')
            );
            
            resolve({ 
              success: true, 
              duplicate: isDuplicate,
              message: message || undefined 
            });
          } else {
            console.warn(`[ConsistencyRelay] ${relayUrl} rejected event:`, message);
            resolve({ 
              success: false, 
              duplicate: false,
              message: message || 'Event rejected' 
            });
          }
        }
      } catch (error) {
        console.error(`[ConsistencyRelay] Error parsing message from ${relayUrl}:`, error);
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      resolve({ success: false, duplicate: false, message: `WebSocket error: ${error}` });
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      // If we haven't resolved yet, it means we didn't get an OK response
      resolve({ success: false, duplicate: false, message: 'Connection closed without response' });
    };
  });
}

/**
 * Handle messages from consistency relay
 */
function handleConsistencyRelayMessage(message: any[]): void {
  const [type, ...args] = message;

  switch (type) {
    case 'EVENT':
      const [subscriptionId, event] = args;
      // Add event if it doesn't exist
      if (!consistencyRelayEvents.find(e => e.id === event.id)) {
        consistencyRelayEvents = [event, ...consistencyRelayEvents];
        // Keep only last 1000 events in memory
        if (consistencyRelayEvents.length > 1000) {
          consistencyRelayEvents = consistencyRelayEvents.slice(0, 1000);
        }
        console.log('[ConsistencyRelay] New event received:', event.kind);
        
        // Broadcast event to outbox and inbox relays
        broadcastEventToOutboxAndInbox(event).catch(error => {
          console.error('[ConsistencyRelay] Failed to broadcast event:', error);
        });
      }
      break;
    
    case 'EOSE':
      console.log('[ConsistencyRelay] End of stored events');
      break;
    
    case 'NOTICE':
      console.log('[ConsistencyRelay] Notice:', args[0]);
      break;
  }
}

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

  await connectToConsistencyRelay(relayUrl, userData.pubkey);
}

/**
 * Handle disconnect consistency relay request
 */
async function handleDisconnectConsistencyRelay(): Promise<void> {
  if (consistencyRelayWs) {
    consistencyRelayWs.close();
    consistencyRelayWs = null;
  }
  consistencyRelayUrl = null;
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
}

/**
 * Handle get consistency relay events request
 */
async function handleGetConsistencyRelayEvents(): Promise<NostrEvent[]> {
  return consistencyRelayEvents;
}

/**
 * Handle get consistency relay status request
 */
async function handleGetConsistencyRelayStatus(): Promise<{ connected: boolean; url: string | null; reconnectAttempts: number }> {
  const isConnected = consistencyRelayWs !== null && consistencyRelayWs.readyState === WebSocket.OPEN;
  return {
    connected: isConnected,
    url: consistencyRelayUrl,
    reconnectAttempts,
  };
}

// Initialize consistency relay connection when user logs in
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.userData) {
    // User logged in or out
    if (changes.userData.newValue) {
      initializeConsistencyRelay().catch(console.error);
    } else {
      // User logged out, disconnect
      handleDisconnectConsistencyRelay().catch(console.error);
    }
  }
  
  if (areaName === 'local' && changes.consistencyRelayUrl) {
    // Consistency relay URL changed
    if (changes.consistencyRelayUrl.newValue) {
      initializeConsistencyRelay().catch(console.error);
    } else {
      // URL removed, disconnect
      handleDisconnectConsistencyRelay().catch(console.error);
    }
  }
});

// Try to connect on startup if user is already logged in
initializeConsistencyRelay().catch(console.error);
