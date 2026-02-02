/**
 * Contacts Manager for NIP-02 contact list operations
 */

import type { Event as NostrEvent } from 'nostr-tools';
import { RelayManager } from './relayManager';
import { Database, type NostrContact } from './db';
import { Nip07TabService } from './nip07Tab';

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
   * Create a new contact list event (unsigned)
   */
  createContactListEvent(contacts: NostrContact[]): any {
    const tags: string[][] = contacts.map(contact => {
      const tag = ['p', contact.pubkey];
      if (contact.relay) {
        tag.push(contact.relay);
      }
      if (contact.petname) {
        // Ensure we have relay field (empty string) if we have petname
        if (!contact.relay) {
          tag.push('');
        }
        tag.push(contact.petname);
      }
      return tag;
    });

    return {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    };
  }

  /**
   * Publish a new contact list
   */
  async publishContacts(contacts: NostrContact[]): Promise<void> {
    // Create unsigned event
    const unsignedEvent = this.createContactListEvent(contacts);

    // Sign with NIP-07
    const signedEvent = await Nip07TabService.signEvent(unsignedEvent);

    // Publish to relays
    await this.relayManager.publish(signedEvent as any);

    // Update database
    await Database.updateUserContacts(contacts);
  }

  /**
   * Remove a contact and publish updated list
   */
  async removeContact(pubkey: string): Promise<void> {
    const userData = await Database.getUserData();
    if (!userData) {
      throw new Error('User not logged in');
    }

    // Remove contact from list
    const updatedContacts = userData.contacts.filter(c => c.pubkey !== pubkey);

    // Publish updated list
    await this.publishContacts(updatedContacts);
  }

  /**
   * Add a contact and publish updated list
   */
  async addContact(contact: NostrContact): Promise<void> {
    const userData = await Database.getUserData();
    if (!userData) {
      throw new Error('User not logged in');
    }

    // Check if contact already exists
    const exists = userData.contacts.some(c => c.pubkey === contact.pubkey);
    if (exists) {
      throw new Error('Contact already exists');
    }

    // Add contact to list
    const updatedContacts = [...userData.contacts, contact];

    // Publish updated list
    await this.publishContacts(updatedContacts);
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
