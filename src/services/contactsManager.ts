/**
 * Contacts Manager for NIP-02 contact list operations
 */

import type { Event as NostrEvent } from 'nostr-tools';
import { RelayManager } from './relayManager';
import { Database, type NostrContact } from './db';

export class ContactsManager {
  private relayManager: RelayManager;

  constructor(relayManager: RelayManager) {
    this.relayManager = relayManager;
  }

  /**
   * Parse contacts from kind 3 event
   */
  private parseContacts(event: NostrEvent): NostrContact[] {
    const contacts: NostrContact[] = [];

    for (const tag of event.tags) {
      if (tag[0] === 'p') {
        const pubkey = tag[1];
        const relay = tag[2] || undefined;
        const petname = tag[3] || undefined;

        if (pubkey) {
          contacts.push({ pubkey, relay, petname });
        }
      }
    }

    return contacts;
  }

  /**
   * Fetch contact list for a pubkey
   */
  async fetchContacts(pubkey: string): Promise<NostrContact[]> {
    const events = await this.relayManager.fetchEvents([
      {
        kinds: [3],
        authors: [pubkey],
        limit: 1,
      }
    ]);

    if (events.length === 0) {
      return [];
    }

    // Get the most recent contact list event
    const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
    const contacts = this.parseContacts(latestEvent);
    
    // Save to database
    await Database.updateUserContacts(contacts);

    return contacts;
  }

  /**
   * Fetch user's relay list (NIP-65, kind 10002)
   */
  async fetchUserRelays(pubkey: string): Promise<string[]> {
    try {
      const events = await this.relayManager.fetchEvents([
        {
          kinds: [10002],
          authors: [pubkey],
          limit: 1,
        }
      ], 3000);

      if (events.length === 0) {
        console.log('[ContactsManager] No relay list events found for user');
        return [];
      }

      const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
      const relays: string[] = [];

      for (const tag of latestEvent.tags) {
        if (tag[0] === 'r' && tag[1]) {
          relays.push(tag[1]);
        }
      }

      console.log(`[ContactsManager] Found ${relays.length} relays from user's relay list`);
      return relays;
    } catch (error) {
      console.error('[ContactsManager] Error fetching user relays:', error);
      // Return empty array, this is not critical - we have default relays
      return [];
    }
  }

  /**
   * Subscribe to contact list updates
   */
  subscribeToContactList(
    pubkey: string,
    onUpdate: (contacts: NostrContact[]) => void
  ): string {
    return this.relayManager.subscribe(
      [
        {
          kinds: [3],
          authors: [pubkey],
        }
      ],
      (event: NostrEvent) => {
        const contacts = this.parseContacts(event);
        Database.updateUserContacts(contacts);
        onUpdate(contacts);
      }
    );
  }

  /**
   * Unsubscribe from contact list updates
   */
  unsubscribe(subId: string): void {
    this.relayManager.unsubscribe(subId);
  }
}
