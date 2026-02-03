/**
 * Database layer using chrome.storage.local for persistence
 */

// Define local types for storage
export interface NostrProfile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud06?: string;
  lud16?: string;
  website?: string;
}

export interface NostrContact {
  pubkey: string;
  relay?: string;
  petname?: string;
}

export interface StoredContact extends NostrContact {
  profile?: NostrProfile;
}

// NIP-11 Relay Information Document
export interface RelayInfo {
  name?: string;
  description?: string;
  pubkey?: string;
  contact?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
  icon?: string;
}

// NIP-65 Relay metadata
export interface RelayMetadata {
  url: string;
  type: 'read' | 'write' | 'both'; // both = no marker in NIP-65
  info?: RelayInfo; // NIP-11 relay information
}

export interface UserData {
  pubkey: string;
  profile?: NostrProfile;
  contacts: NostrContact[];
  relays: string[]; // Legacy simple relay list
  relayMetadata?: RelayMetadata[]; // NIP-65 relay list with read/write markers
  lastUpdated: number;
  firstLoginTimestamp?: number; // Timestamp of first login (used to filter old events)
}

const STORAGE_KEYS = {
  USER_DATA: 'userData',
  CONTACT_PROFILES: 'contactProfiles',
  CONSISTENCY_RELAY_URL: 'consistencyRelayUrl',
} as const;

export class Database {
  /**
   * Get user data
   */
  static async getUserData(): Promise<UserData | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.USER_DATA);
    return result[STORAGE_KEYS.USER_DATA] || null;
  }

  /**
   * Set user data
   */
  static async setUserData(userData: UserData): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_DATA]: userData });
  }

  /**
   * Update user profile
   */
  static async updateUserProfile(profile: NostrProfile): Promise<void> {
    const userData = await this.getUserData();
    if (userData) {
      userData.profile = profile;
      await this.setUserData(userData);
    }
  }

  /**
   * Update user contacts
   */
  static async updateUserContacts(contacts: NostrContact[]): Promise<void> {
    const userData = await this.getUserData();
    if (userData) {
      userData.contacts = contacts;
      userData.lastUpdated = Date.now();
      await this.setUserData(userData);
    }
  }

  /**
   * Update user relays (legacy)
   */
  static async updateUserRelays(relays: string[]): Promise<void> {
    const userData = await this.getUserData();
    if (userData) {
      userData.relays = relays;
      await this.setUserData(userData);
    }
  }

  /**
   * Update user relay metadata (NIP-65)
   */
  static async updateUserRelayMetadata(relayMetadata: RelayMetadata[]): Promise<void> {
    const userData = await this.getUserData();
    if (userData) {
      userData.relayMetadata = relayMetadata;
      // Also update legacy relays list for backwards compatibility
      userData.relays = relayMetadata.map(r => r.url);
      userData.lastUpdated = Date.now();
      await this.setUserData(userData);
    }
  }

  /**
   * Get user relay metadata (NIP-65)
   */
  static async getUserRelayMetadata(): Promise<RelayMetadata[]> {
    const userData = await this.getUserData();
    return userData?.relayMetadata || [];
  }

  /**
   * Get contact profiles (cached)
   */
  static async getContactProfiles(): Promise<Record<string, NostrProfile>> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONTACT_PROFILES);
    return result[STORAGE_KEYS.CONTACT_PROFILES] || {};
  }

  /**
   * Set contact profile
   */
  static async setContactProfile(pubkey: string, profile: NostrProfile): Promise<void> {
    const profiles = await this.getContactProfiles();
    profiles[pubkey] = profile;
    await chrome.storage.local.set({ [STORAGE_KEYS.CONTACT_PROFILES]: profiles });
  }

  /**
   * Set multiple contact profiles
   */
  static async setContactProfiles(profiles: Record<string, NostrProfile>): Promise<void> {
    const existing = await this.getContactProfiles();
    const merged = { ...existing, ...profiles };
    await chrome.storage.local.set({ [STORAGE_KEYS.CONTACT_PROFILES]: merged });
  }

  /**
   * Get contacts with their profiles
   */
  static async getContactsWithProfiles(): Promise<StoredContact[]> {
    const userData = await this.getUserData();
    if (!userData) return [];

    const profiles = await this.getContactProfiles();
    
    return userData.contacts.map(contact => ({
      ...contact,
      profile: profiles[contact.pubkey],
    }));
  }

  /**
   * Remove contact
   */
  static async removeContact(pubkey: string): Promise<void> {
    const userData = await this.getUserData();
    if (userData) {
      userData.contacts = userData.contacts.filter(c => c.pubkey !== pubkey);
      userData.lastUpdated = Date.now();
      await this.setUserData(userData);
    }
  }

  /**
   * Clear all data including user data, cached relay lists, and broadcast history
   */
  static async clear(): Promise<void> {
    // Get all keys from storage
    const allData = await chrome.storage.local.get(null);
    const keys = Object.keys(allData);
    
    // Find all keys that need to be removed
    const keysToRemove = keys.filter(key => {
      // Remove user data keys
      if (key === STORAGE_KEYS.USER_DATA) return true;
      if (key === STORAGE_KEYS.CONTACT_PROFILES) return true;
      if (key === STORAGE_KEYS.CONSISTENCY_RELAY_URL) return true;
      
      // Remove cached relay lists (format: relayList_${pubkey})
      if (key.startsWith('relayList_')) return true;
      
      // Remove broadcast history
      if (key === 'broadcastHistory') return true;
      
      return false;
    });
    
    console.log('[Database] Clearing', keysToRemove.length, 'keys from storage');
    
    // Remove all identified keys
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  }

  /**
   * Check if user is logged in
   */
  static async isLoggedIn(): Promise<boolean> {
    const userData = await this.getUserData();
    return userData !== null && !!userData.pubkey;
  }

  /**
   * Get consistency relay URL
   */
  static async getConsistencyRelayUrl(): Promise<string | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONSISTENCY_RELAY_URL);
    return result[STORAGE_KEYS.CONSISTENCY_RELAY_URL] || null;
  }

  /**
   * Set consistency relay URL
   */
  static async setConsistencyRelayUrl(url: string): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.CONSISTENCY_RELAY_URL]: url });
  }

  /**
   * Clear consistency relay URL
   */
  static async clearConsistencyRelayUrl(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS.CONSISTENCY_RELAY_URL);
  }

  /**
   * Get first login timestamp (used to filter old events from consistency relay)
   * Returns null if user has never logged in
   */
  static async getFirstLoginTimestamp(): Promise<number | null> {
    const userData = await this.getUserData();
    return userData?.firstLoginTimestamp || null;
  }

  /**
   * Set first login timestamp if not already set
   * This should only be set once on the user's first login
   */
  static async ensureFirstLoginTimestamp(): Promise<void> {
    const userData = await this.getUserData();
    if (userData && !userData.firstLoginTimestamp) {
      userData.firstLoginTimestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
      await this.setUserData(userData);
      console.log('[Database] Set first login timestamp:', userData.firstLoginTimestamp);
    }
  }
}
