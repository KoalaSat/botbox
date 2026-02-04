/**
 * Relay List Manager - Manages user's relay list (NIP-65)
 */

import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools';
import { Database, type RelayMetadata } from './db';
import { RelayManager } from './relayManager';

export class RelayListManager {
  private relayManager: RelayManager;

  constructor(relayManager: RelayManager) {
    this.relayManager = relayManager;
  }

  /**
   * Fetch relay list (kind 10002) for any pubkey from relays
   * For the logged-in user, returns local data immediately if available
   * For other pubkeys (contacts), checks cache or fetches from network
   */
  async fetchRelayList(pubkey: string): Promise<RelayMetadata[]> {
    try {
      console.log('[RelayListManager] Fetching relay list for', pubkey.substring(0, 8));

      // Check if this is the logged-in user
      const userData = await Database.getUserData();
      const isLoggedInUser = userData && userData.pubkey === pubkey;

      if (isLoggedInUser) {
        // For logged-in user, use existing logic with local database
        const localRelayMetadata = await Database.getUserRelayMetadata();
        
        if (localRelayMetadata.length > 0) {
          console.log('[RelayListManager] Returning user\'s local relay metadata');
        
          
          // Refresh from network in background
          this.refreshRelayListFromNetwork(pubkey).catch(err => {
            console.error('[RelayListManager] Background refresh failed:', err);
          });
          
          return localRelayMetadata;
        }
        
        // No local data - must fetch from network (first time)
        console.log('[RelayListManager] No local data, fetching from network...');
        const events = await this.relayManager.fetchEvents([
          {
            kinds: [10002],
            authors: [pubkey],
            limit: 1,
          },
        ], 3000);

        if (events.length === 0) {
          console.log('[RelayListManager] No relay list found on relays');
          const defaults = this.getDefaultRelayMetadata();
          await Database.updateUserRelayMetadata(defaults);
          return defaults;
        }

        const relayList = this.parseRelayListEvent(events[0]);
        console.log('[RelayListManager] Fetched relay list from Nostr:', relayList);
        await Database.updateUserRelayMetadata(relayList);
        return relayList;
      } else {
        // For other pubkeys (contacts), check cache or fetch from network
        const cachedRelayList = await this.getContactRelayListFromCache(pubkey);
        
        if (cachedRelayList && cachedRelayList.length > 0) {
          console.log('[RelayListManager] Returning cached relay list for contact');
          
          // Refresh cache in background
          this.refreshContactRelayListCache(pubkey).catch(err => {
            console.error('[RelayListManager] Background cache refresh failed:', err);
          });
          
          return cachedRelayList;
        }
        
        console.log('[RelayListManager] No cache, fetching contact relay list from network...');
        const events = await this.relayManager.fetchEvents([
          {
            kinds: [10002],
            authors: [pubkey],
            limit: 1,
          },
        ], 3000);

        if (events.length === 0) {
          console.log('[RelayListManager] No relay list found for contact');
          return [];
        }

        const relayList = this.parseRelayListEvent(events[0]);
        console.log('[RelayListManager] Fetched contact relay list:', relayList.length, 'relays');
        
        // Cache it
        await this.saveContactRelayListToCache(pubkey, relayList);
        
        return relayList;
      }
    } catch (error) {
      console.error('[RelayListManager] Error fetching relay list:', error);
      
      // Check if this is the logged-in user
      const userData = await Database.getUserData();
      const isLoggedInUser = userData && userData.pubkey === pubkey;
      
      if (isLoggedInUser) {
        const localRelayMetadata = await Database.getUserRelayMetadata();
        if (localRelayMetadata.length > 0) {
          console.log('[RelayListManager] Returning local relay metadata after error');
          return localRelayMetadata;
        }
        
        const defaults = this.getDefaultRelayMetadata();
        await Database.updateUserRelayMetadata(defaults);
        return defaults;
      } else {
        // For contacts, return cached data or empty
        const cachedRelayList = await this.getContactRelayListFromCache(pubkey);
        return cachedRelayList || [];
      }
    }
  }

  /**
   * Get contact's relay list from cache
   */
  private async getContactRelayListFromCache(pubkey: string): Promise<RelayMetadata[] | null> {
    try {
      const result = await chrome.storage.local.get(`relayList_${pubkey}`);
      // Handle Firefox compatibility: result might be undefined
      if (!result || typeof result !== 'object') {
        return null;
      }
      
      const cached = result[`relayList_${pubkey}`];
      
      if (!cached) {
        return null;
      }
      
      // Check if cache is still valid (24 hours)
      const now = Date.now();
      if (now - cached.timestamp > 24 * 60 * 60 * 1000) {
        console.log('[RelayListManager] Cache expired for', pubkey.substring(0, 8));
        return null;
      }
      
      return cached.relayList;
    } catch (error) {
      console.error('[RelayListManager] Error reading cache:', error);
      return null;
    }
  }

  /**
   * Save contact's relay list to cache
   */
  private async saveContactRelayListToCache(pubkey: string, relayList: RelayMetadata[]): Promise<void> {
    try {
      await chrome.storage.local.set({
        [`relayList_${pubkey}`]: {
          relayList,
          timestamp: Date.now(),
        }
      });
    } catch (error) {
      console.error('[RelayListManager] Error saving to cache:', error);
    }
  }

  /**
   * Refresh contact's relay list cache in background
   */
  private async refreshContactRelayListCache(pubkey: string): Promise<void> {
    try {
      console.log('[RelayListManager] Background refresh for contact', pubkey.substring(0, 8));
      
      const events = await this.relayManager.fetchEvents([
        {
          kinds: [10002],
          authors: [pubkey],
          limit: 1,
        },
      ], 3000);

      if (events.length === 0) {
        console.log('[RelayListManager] No new relay list data for contact');
        return;
      }

      const relayList = this.parseRelayListEvent(events[0]);
      await this.saveContactRelayListToCache(pubkey, relayList);
      console.log('[RelayListManager] Updated cache for contact');
    } catch (error) {
      console.error('[RelayListManager] Background cache refresh error:', error);
    }
  }

  /**
   * Refresh relay list from network in background (doesn't block)
   * Preserves NIP-11 info from existing relays
   */
  private async refreshRelayListFromNetwork(pubkey: string): Promise<void> {
    try {
      console.log('[RelayListManager] Background refresh: fetching from network...');
      
      const events = await this.relayManager.fetchEvents([
        {
          kinds: [10002],
          authors: [pubkey],
          limit: 1,
        },
      ], 3000);

      if (events.length === 0) {
        console.log('[RelayListManager] Background refresh: no new data');
        return;
      }

      // Get existing relay metadata to preserve NIP-11 info
      const existingRelays = await Database.getUserRelayMetadata();
      const existingInfoMap = new Map(
        existingRelays.map(r => [r.url, r.info])
      );

      // Parse new relay list and preserve existing NIP-11 info
      const relayList = this.parseRelayListEvent(events[0]);
      const mergedRelayList = relayList.map(relay => ({
        ...relay,
        info: existingInfoMap.get(relay.url) || relay.info,
      }));
      
      console.log('[RelayListManager] Background refresh: updating with new data (preserving NIP-11 info)');
      await Database.updateUserRelayMetadata(mergedRelayList);
    } catch (error) {
      console.error('[RelayListManager] Background refresh error:', error);
      // Silent fail - we already have local data
    }
  }

  /**
   * Parse a kind 10002 event into RelayMetadata array
   */
  private parseRelayListEvent(event: NostrEvent): RelayMetadata[] {
    const relayMetadata: RelayMetadata[] = [];

    for (const tag of event.tags) {
      if (tag[0] === 'r' && tag[1]) {
        const url = tag[1];
        const marker = tag[2]?.toLowerCase();

        let type: 'read' | 'write' | 'both' = 'both';
        if (marker === 'read') {
          type = 'read';
        } else if (marker === 'write') {
          type = 'write';
        }

        relayMetadata.push({ url, type });
      }
    }

    return relayMetadata;
  }

  /**
   * Get default relay metadata if user has no relay list
   */
  private getDefaultRelayMetadata(): RelayMetadata[] {
    const defaultRelays = this.relayManager.getRelays();
    return defaultRelays.map(url => ({ url, type: 'both' as const }));
  }

  /**
   * Add a relay to the user's relay list
   */
  async addRelay(url: string, type: 'read' | 'write' | 'both'): Promise<RelayMetadata[]> {
    const currentRelays = await Database.getUserRelayMetadata();

    // Check if relay already exists
    if (currentRelays.some(r => r.url === url)) {
      throw new Error('Relay already exists in your list');
    }

    // Add the new relay
    const updatedRelays = [...currentRelays, { url, type }];

    // Save to database
    await Database.updateUserRelayMetadata(updatedRelays);

    return updatedRelays;
  }

  /**
   * Remove a relay from the user's relay list
   */
  async removeRelay(url: string): Promise<RelayMetadata[]> {
    const currentRelays = await Database.getUserRelayMetadata();

    // Filter out the relay
    const updatedRelays = currentRelays.filter(r => r.url !== url);

    if (updatedRelays.length === currentRelays.length) {
      throw new Error('Relay not found in your list');
    }

    // Save to database
    await Database.updateUserRelayMetadata(updatedRelays);

    return updatedRelays;
  }

  /**
   * Update a relay's type (read/write/both)
   */
  async updateRelayType(url: string, type: 'read' | 'write' | 'both'): Promise<RelayMetadata[]> {
    const currentRelays = await Database.getUserRelayMetadata();

    // Find and update the relay
    const updatedRelays = currentRelays.map(r => 
      r.url === url ? { ...r, type } : r
    );

    // Check if relay was found
    if (JSON.stringify(updatedRelays) === JSON.stringify(currentRelays)) {
      throw new Error('Relay not found in your list');
    }

    // Save to database
    await Database.updateUserRelayMetadata(updatedRelays);

    return updatedRelays;
  }

  /**
   * Publish relay list to Nostr (kind 10002 event)
   */
  async publishRelayList(
    relayMetadata: RelayMetadata[],
    signEvent: (event: any) => Promise<NostrEvent>
  ): Promise<void> {
    try {
      console.log('[RelayListManager] Publishing relay list:', relayMetadata);

      // Build tags for the relay list event
      const tags: string[][] = relayMetadata.map(relay => {
        const tag = ['r', relay.url];
        // Only add marker if it's not 'both'
        if (relay.type !== 'both') {
          tag.push(relay.type);
        }
        return tag;
      });

      // Create the event (kind 10002)
      const unsignedEvent = {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
      };

      // Sign the event using NIP-07
      const signedEvent = await signEvent(unsignedEvent);

      console.log('[RelayListManager] Signed relay list event:', signedEvent);

      // Publish to relays
      await this.relayManager.publish(signedEvent);

      console.log('[RelayListManager] Successfully published relay list');

      // Update the database with the new relay list
      await Database.updateUserRelayMetadata(relayMetadata);
    } catch (error) {
      console.error('[RelayListManager] Error publishing relay list:', error);
      throw error;
    }
  }

  /**
   * Get relay list from database
   */
  async getRelayList(): Promise<RelayMetadata[]> {
    const relayMetadata = await Database.getUserRelayMetadata();
    
    // If no relay metadata exists, return defaults
    if (relayMetadata.length === 0) {
      return this.getDefaultRelayMetadata();
    }

    return relayMetadata;
  }

  /**
   * Get write relays (for publishing user's own events)
   */
  async getWriteRelays(): Promise<string[]> {
    const relayMetadata = await this.getRelayList();
    return relayMetadata
      .filter(r => r.type === 'write' || r.type === 'both')
      .map(r => r.url);
  }

  /**
   * Get read relays (for fetching events where user is mentioned)
   */
  async getReadRelays(): Promise<string[]> {
    const relayMetadata = await this.getRelayList();
    return relayMetadata
      .filter(r => r.type === 'read' || r.type === 'both')
      .map(r => r.url);
  }
}
