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
   * Fetch user's relay list (kind 10002) from relays
   * Returns local data immediately if available, then optionally refreshes from network
   */
  async fetchRelayList(pubkey: string, skipNetworkFetch: boolean = false): Promise<RelayMetadata[]> {
    try {
      console.log('[RelayListManager] Fetching relay list for', pubkey);

      // First check if we have local relay metadata - return immediately
      const localRelayMetadata = await Database.getUserRelayMetadata();
      
      if (localRelayMetadata.length > 0) {
        console.log('[RelayListManager] Returning local relay metadata immediately');
        
        // If we want to skip network fetch, return now
        if (skipNetworkFetch) {
          return localRelayMetadata;
        }
        
        // Otherwise, refresh from network in background (but return local data now)
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
      ], 3000); // 3 second timeout

      if (events.length === 0) {
        console.log('[RelayListManager] No relay list found on relays');
        console.log('[RelayListManager] Using default relays');
        const defaults = this.getDefaultRelayMetadata();
        await Database.updateUserRelayMetadata(defaults);
        return defaults;
      }

      // Parse the relay list from the event
      const relayList = this.parseRelayListEvent(events[0]);
      console.log('[RelayListManager] Fetched relay list from Nostr:', relayList);

      // Save to database
      await Database.updateUserRelayMetadata(relayList);

      return relayList;
    } catch (error) {
      console.error('[RelayListManager] Error fetching relay list:', error);
      
      // Try to return local data first
      const localRelayMetadata = await Database.getUserRelayMetadata();
      if (localRelayMetadata.length > 0) {
        console.log('[RelayListManager] Returning local relay metadata after error');
        return localRelayMetadata;
      }
      
      // Fallback to defaults
      const defaults = this.getDefaultRelayMetadata();
      await Database.updateUserRelayMetadata(defaults);
      return defaults;
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
