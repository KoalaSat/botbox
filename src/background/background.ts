/**
 * Background Service Worker
 * Handles extension lifecycle, message passing, and Nostr operations
 */

import { RelayManager } from '../services/relayManager';
import { ContactsManager } from '../services/contactsManager';
import { ProfileManager } from '../services/profileManager';
import { Database, type UserData } from '../services/db';
import { Nip07TabService } from '../services/nip07Tab';

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
  LOGOUT = 'LOGOUT',
  GET_LOGIN_STATUS = 'GET_LOGIN_STATUS',
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
 * Get or create relay manager
 */
function getRelayManager(): RelayManager {
  if (!relayManager) {
    relayManager = RelayManager.createDefault();
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

      case MessageType.LOGOUT:
        handleLogout()
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
 * This fetches the pubkey and relays from window.nostr in the active tab
 */
async function handleConnectNip07(): Promise<{ pubkey: string; relays: Record<string, { read: boolean; write: boolean }> | null }> {
  // Wait for NIP-07 provider to be available
  const hasProvider = await Nip07TabService.waitForProvider(5000);
  if (!hasProvider) {
    throw new Error('NIP-07 provider not found. Please install a Nostr extension like Alby or nos2x, and make sure you are on a regular webpage (http:// or https://).');
  }

  // Get public key from active tab
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
  const rm = getRelayManager();
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
    const rm = getRelayManager();
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

  const rm = getRelayManager();
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
 * Fetch contacts with profiles
 */
async function handleFetchContacts(): Promise<any> {
  return await Database.getContactsWithProfiles();
}

/**
 * Remove a contact
 */
async function handleRemoveContact(payload: { pubkey: string }): Promise<void> {
  const rm = getRelayManager();
  const contactsManager = new ContactsManager(rm);
  await contactsManager.removeContact(payload.pubkey);
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
