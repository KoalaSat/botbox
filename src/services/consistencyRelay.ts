/**
 * Consistency Relay Service
 * Manages WebSocket connection to a consistency relay and monitors:
 * 1. Events authored by the user - broadcasts to user's outbox and tagged users' inbox relays
 * 2. Events where the user is tagged - broadcasts to user's inbox relays
 * 
 * Special handling for Profile (kind 0) and Relay List (kind 10002) events:
 * broadcasts to all read relays of contacts in the user's follow list
 */

import type { Event as NostrEvent } from 'nostr-tools';
import { Database } from './db';
import { RelayListManager } from './relayListManager';
import type { RelayManager } from './relayManager';

interface BroadcastResult {
  success: boolean;
  duplicate: boolean;
  message?: string;
}

interface ConsistencyRelayStatus {
  connected: boolean;
  url: string | null;
  reconnectAttempts: number;
}

/**
 * Consistency Relay Service
 */
export class ConsistencyRelayService {
  private ws: WebSocket | null = null;
  private events: NostrEvent[] = [];
  private url: string | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_EVENTS_IN_MEMORY = 1000;
  private readonly BROADCAST_TIMEOUT = 10000; // 10 seconds

  constructor(private getRelayManager: () => Promise<RelayManager>) {}

  /**
   * Initialize connection on startup if user is logged in
   */
  async initialize(): Promise<void> {
    const userData = await Database.getUserData();
    if (!userData) {
      return; // Not logged in yet
    }

    const relayUrl = await Database.getConsistencyRelayUrl();
    if (relayUrl) {
      console.log('[ConsistencyRelay] Auto-connecting to:', relayUrl);
      await this.connect(relayUrl, userData.pubkey)
    }
  }

  /**
   * Connect to consistency relay
   */
  async connect(url: string, pubkey: string): Promise<void> {
    // Close existing connection if any
    this.disconnect();

    this.url = url;

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);

        ws.onopen = () => {
          console.log('[ConsistencyRelay] Connected to:', url);
          this.ws = ws;
          this.reconnectAttempts = 0;

          // Subscribe to user's events (authored by user)
          const subscriptionId = 'consistency-relay-authored-' + Date.now();
          const filter = { authors: [pubkey] };
          const req = JSON.stringify(['REQ', subscriptionId, filter]);
          ws.send(req);

          // Subscribe to events where user is tagged
          const taggedSubscriptionId = 'consistency-relay-tagged-' + Date.now();
          const taggedFilter = { '#p': [pubkey] };
          const taggedReq = JSON.stringify(['REQ', taggedSubscriptionId, taggedFilter]);
          ws.send(taggedReq);

          console.log('[ConsistencyRelay] Subscribed to authored events and tagged events');

          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
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
          this.ws = null;

          // Auto-reconnect if not manually disconnected
          this.attemptReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect from consistency relay
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.url = null;
    this.reconnectAttempts = this.MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
    // Clear in-memory events
    this.events = [];
  }

  /**
   * Get connection status
   */
  getStatus(): ConsistencyRelayStatus {
    const isConnected = this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    return {
      connected: isConnected,
      url: this.url,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Get received events
   */
  getEvents(): NostrEvent[] {
    return this.events;
  }

  /**
   * Attempt to reconnect to consistency relay
   */
  private async attemptReconnect(): Promise<void> {
    if (this.url && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      console.log(
        `[ConsistencyRelay] Reconnecting attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}...`
      );
      setTimeout(async () => {
        const userData = await Database.getUserData();
        if (userData && this.url) {
          await this.connect(this.url, userData.pubkey).catch(console.error);
        }
      }, this.RECONNECT_DELAY);
    }
  }

  /**
   * Handle messages from consistency relay
   */
  private handleMessage(message: any[]): void {
    const [type, ...args] = message;

    switch (type) {
      case 'EVENT':
        const [subscriptionId, event] = args;
        this.handleEvent(event);
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
   * Handle incoming event
   */
  private async handleEvent(event: NostrEvent): Promise<void> {
    // Skip if event already exists
    if (this.events.find((e) => e.id === event.id)) {
      return;
    }

    // Skip follow list events (kind 3) from other users - they are not relevant
    const userData = await Database.getUserData();
    if (userData && event.kind === 3 && event.pubkey !== userData.pubkey) {
      console.log('[ConsistencyRelay] Skipping follow list event from other user');
      return;
    }

    // Add event to memory
    this.events = [event, ...this.events];
    
    // Keep only last N events in memory
    if (this.events.length > this.MAX_EVENTS_IN_MEMORY) {
      this.events = this.events.slice(0, this.MAX_EVENTS_IN_MEMORY);
    }
    
    console.log('[ConsistencyRelay] New event received:', event.kind);

    // Broadcast event to outbox and inbox relays
    this.broadcastEvent(event).catch((error) => {
      console.error('[ConsistencyRelay] Failed to broadcast event:', error);
    });
  }

  /**
   * Broadcast event to user's outbox relays and tagged users' inbox relays
   * Special handling for Profile (kind 0) and Relay List (kind 10002) events:
   * these are broadcast to all read relays of all contacts in the user's follow list
   */
  private async broadcastEvent(event: NostrEvent): Promise<void> {
    try {
      console.log(
        '[ConsistencyRelay] Broadcasting event',
        event.id.substring(0, 8),
        'kind:',
        event.kind
      );

      const userData = await Database.getUserData();
      if (!userData) {
        console.warn('[ConsistencyRelay] No user data, cannot broadcast');
        return;
      }

      const rm = await this.getRelayManager();
      const relayListManager = new RelayListManager(rm);

      let allTargetRelays: string[] = [];

      // Check if this event has already been broadcast
      const alreadyBroadcast = await this.hasBeenBroadcast(event.id);
      if (alreadyBroadcast) {
        console.log('[ConsistencyRelay] Event', event.id.substring(0, 8), 'already broadcast, skipping');
        return;
      }

      // Check if event was created before user's first login (don't broadcast old events)
      const firstLoginTimestamp = await Database.getFirstLoginTimestamp();
      if (firstLoginTimestamp && event.created_at < firstLoginTimestamp) {
        console.log(
          '[ConsistencyRelay] Event created before first login (',
          event.created_at,
          '<',
          firstLoginTimestamp,
          '), skipping broadcast'
        );
        return;
      }

      // Check if user is the author of this event
      const isUserAuthor = event.pubkey === userData.pubkey;

      // Check if user is tagged in this event
      const taggedPubkeys = this.extractTaggedPubkeys(event);
      const isUserTagged = taggedPubkeys.includes(userData.pubkey);

      if (!isUserAuthor && isUserTagged) {
        // Event where user is tagged (but not authored by user)
        // Broadcast to user's read relays (inbox)
        console.log('[ConsistencyRelay] User is tagged in event, broadcasting to inbox relays');
        const inboxRelays = await relayListManager.getReadRelays();
        console.log('[ConsistencyRelay] User inbox relays:', inboxRelays.length);
        allTargetRelays = inboxRelays;
      } else if (isUserAuthor && (event.kind === 0 || event.kind === 10002)) {
        // Special handling for Profile (kind 0) and Relay List (kind 10002) events
        // authored by the user
        console.log('[ConsistencyRelay] Special handling for Profile/Relay List event');
        
        // Get all contacts from user's follow list
        const contacts = userData.contacts || [];
        console.log('[ConsistencyRelay] User has', contacts.length, 'contacts');

        if (contacts.length === 0) {
          console.warn('[ConsistencyRelay] No contacts found, falling back to outbox relays');
          const outboxRelays = await relayListManager.getWriteRelays();
          allTargetRelays = outboxRelays;
        } else {
          // Collect all read relays for all contacts
          const contactsReadRelays = await this.collectReadRelaysForContacts(contacts, relayListManager);
          console.log('[ConsistencyRelay] Collected', contactsReadRelays.length, 'read relays from contacts');
          
          // Also include user's own outbox relays
          const outboxRelays = await relayListManager.getWriteRelays();
          console.log('[ConsistencyRelay] User outbox relays:', outboxRelays.length);
          
          // Combine and deduplicate
          allTargetRelays = [...new Set([...outboxRelays, ...contactsReadRelays])];
        }
      } else if (isUserAuthor) {
        // Normal broadcasting for user-authored events: user's outbox + tagged users' inbox relays
        console.log('[ConsistencyRelay] Broadcasting user-authored event');
        
        // Get user's outbox relays (write relays)
        const outboxRelays = await relayListManager.getWriteRelays();
        console.log('[ConsistencyRelay] User outbox relays:', outboxRelays.length);

        console.log('[ConsistencyRelay] Tagged pubkeys:', taggedPubkeys.length);

        // Collect inbox relays for tagged pubkeys
        const inboxRelays = await this.collectInboxRelays(taggedPubkeys, relayListManager);
        console.log('[ConsistencyRelay] Tagged users inbox relays:', inboxRelays.length);

        // Combine and deduplicate all target relays
        allTargetRelays = [...new Set([...outboxRelays, ...inboxRelays])];
      } else {
        console.log('[ConsistencyRelay] Event not relevant to user (not authored by or tagging user)');
        return;
      }

      // Exclude the consistency relay itself
      allTargetRelays = this.excludeConsistencyRelay(allTargetRelays);

      console.log('[ConsistencyRelay] Total target relays (deduplicated):', allTargetRelays);

      if (allTargetRelays.length === 0) {
        console.warn('[ConsistencyRelay] No target relays found, cannot broadcast');
        return;
      }

      // Broadcast to all target relays
      await this.broadcastToMultipleRelays(allTargetRelays, event);
    } catch (error) {
      console.error('[ConsistencyRelay] Error broadcasting event:', error);
    }
  }

  /**
   * Extract pubkeys from event tags (p tags)
   */
  private extractTaggedPubkeys(event: NostrEvent): string[] {
    const pubkeys: string[] = [];
    for (const tag of event.tags) {
      if (tag[0] === 'p' && tag[1]) {
        pubkeys.push(tag[1]);
      }
    }
    return pubkeys;
  }

  /**
   * Collect read relays for all contacts (used for Profile and Relay List broadcasting)
   * Uses relay hints from contact list (kind 3) and fetches relay lists (kind 10002)
   * Collects all relays first to avoid flooding, then returns deduplicated list
   */
  private async collectReadRelaysForContacts(
    contacts: Array<{ pubkey: string; relay?: string }>,
    relayListManager: RelayListManager
  ): Promise<string[]> {
    if (contacts.length === 0) {
      return [];
    }

    console.log('[ConsistencyRelay] Collecting read relays for', contacts.length, 'contacts...');
    const readRelaysSet = new Set<string>();

    // First, collect relay hints from the contact list (kind 3 event)
    contacts.forEach((contact) => {
      if (contact.relay) {
        readRelaysSet.add(contact.relay);
      }
    });
    console.log('[ConsistencyRelay] Found', readRelaysSet.size, 'relay hints from contact list');

    // Then, try to fetch relay lists (kind 10002) for all contacts in parallel
    const relayListPromises = contacts.map(async (contact) => {
      try {
        // Fetch relay list (uses local cache and network fetch)
        const relayMetadata = await relayListManager.fetchRelayList(contact.pubkey);
        // Get read relays
        const readRelays = relayMetadata
          .filter((r) => r.type === 'read' || r.type === 'both')
          .map((r) => r.url);
        return readRelays;
      } catch (error) {
        console.warn(
          '[ConsistencyRelay] Failed to fetch relay list for contact',
          contact.pubkey.substring(0, 8),
          ':',
          error
        );
        return [];
      }
    });

    // Wait for all relay lists to be collected before broadcasting
    const allReadRelays = await Promise.all(relayListPromises);

    // Flatten and deduplicate
    allReadRelays.forEach((relays) => {
      relays.forEach((relay) => readRelaysSet.add(relay));
    });

    const uniqueRelays = Array.from(readRelaysSet);
    console.log('[ConsistencyRelay] Deduplicated to', uniqueRelays.length, 'unique read relays');

    return uniqueRelays;
  }

  /**
   * Collect inbox relays for tagged pubkeys
   */
  private async collectInboxRelays(
    pubkeys: string[],
    relayListManager: RelayListManager
  ): Promise<string[]> {
    if (pubkeys.length === 0) {
      return [];
    }

    const inboxRelaysSet = new Set<string>();

    // Fetch relay lists for tagged pubkeys in parallel
    const relayListPromises = pubkeys.map(async (pubkey) => {
      try {
        // Fetch relay list (uses local cache and network fetch)
        const relayMetadata = await relayListManager.fetchRelayList(pubkey);
        // Get read relays (inbox)
        const readRelays = relayMetadata
          .filter((r) => r.type === 'read' || r.type === 'both')
          .map((r) => r.url);
        return readRelays;
      } catch (error) {
        console.warn(
          '[ConsistencyRelay] Failed to fetch relay list for',
          pubkey.substring(0, 8),
          ':',
          error
        );
        return [];
      }
    });

    const allInboxRelays = await Promise.all(relayListPromises);

    // Flatten and deduplicate
    allInboxRelays.forEach((relays) => {
      relays.forEach((relay) => inboxRelaysSet.add(relay));
    });

    return Array.from(inboxRelaysSet);
  }

  /**
   * Check if an event has already been broadcast
   * Returns true if the event ID is in the broadcast history
   */
  private async hasBeenBroadcast(eventId: string): Promise<boolean> {
    try {
      const key = 'broadcastHistory';
      const result = await chrome.storage.local.get(key);
      const history: string[] = result[key] || [];
      
      return history.includes(eventId);
    } catch (error) {
      console.error('[ConsistencyRelay] Error checking broadcast history:', error);
      return false;
    }
  }

  /**
   * Mark an event as broadcast by adding its ID to the history
   * Maintains a rolling history of the last 1000 broadcast event IDs
   */
  private async markAsBroadcast(eventId: string): Promise<void> {
    try {
      const key = 'broadcastHistory';
      const result = await chrome.storage.local.get(key);
      const history: string[] = result[key] || [];
      
      // Add the event ID if it's not already in the history
      if (!history.includes(eventId)) {
        history.unshift(eventId);
        
        // Keep only the last 1000 event IDs to avoid storage bloat
        if (history.length > 1000) {
          history.splice(1000);
        }
        
        await chrome.storage.local.set({ [key]: history });
        console.log('[ConsistencyRelay] Marked event', eventId.substring(0, 8), 'as broadcast');
      }
    } catch (error) {
      console.error('[ConsistencyRelay] Error marking event as broadcast:', error);
    }
  }

  /**
   * Exclude consistency relay from target list
   */
  private excludeConsistencyRelay(relays: string[]): string[] {
    if (!this.url) {
      return relays;
    }

    const beforeCount = relays.length;
    const filtered = relays.filter((url) => url !== this.url);
    
    if (beforeCount !== filtered.length) {
      console.log('[ConsistencyRelay] Excluded consistency relay from broadcast targets');
    }
    
    return filtered;
  }

  /**
   * Broadcast to multiple relays and log results
   */
  private async broadcastToMultipleRelays(
    relays: string[],
    event: NostrEvent
  ): Promise<void> {
    const broadcastPromises = relays.map((relayUrl) =>
      this.broadcastToSingleRelay(relayUrl, event)
    );

    const results = await Promise.allSettled(broadcastPromises);

    let successCount = 0;
    let duplicateCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      const relayUrl = relays[index];
      if (result.status === 'fulfilled') {
        const response = result.value;
        if (response.success) {
          successCount++;
          if (response.duplicate) {
            duplicateCount++;
            console.log(`[ConsistencyRelay] ℹ ${relayUrl} already had the event`);
          }
        } else {
          console.log(`[ConsistencyRelay] ℹ ${relayUrl} failed with ${result.status}: ${JSON.stringify(result.value)}`);
          failureCount++;
        }
      } else {
        failureCount++;
        console.error(
          `[ConsistencyRelay] ✗ Failed to broadcast to ${relayUrl}:`,
          result.reason
        );
      }
    });

    console.log(
      `[ConsistencyRelay] Broadcast complete: ${successCount} succeeded, ${duplicateCount} duplicates, ${failureCount} failed`
    );

    // Mark event as broadcast if at least one relay accepted it (excluding duplicates)
    if (successCount > 0) {
      await this.markAsBroadcast(event.id);
    }
  }

  /**
   * Broadcast event to a single relay and capture the OK response
   */
  private async broadcastToSingleRelay(
    relayUrl: string,
    event: NostrEvent
  ): Promise<BroadcastResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ success: false, duplicate: false, message: 'Timeout' });
      }, this.BROADCAST_TIMEOUT);

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
              const isDuplicate =
                message &&
                (message.toLowerCase().includes('duplicate') ||
                  message.toLowerCase().includes('already'));

              resolve({
                success: true,
                duplicate: isDuplicate,
                message: JSON.stringify(message) || undefined,
              });
            } else {
              console.warn(`[ConsistencyRelay] ${relayUrl} rejected event:`, JSON.stringify(message));
              resolve({
                success: false,
                duplicate: false,
                message: JSON.stringify(message) || 'Event rejected',
              });
            }
          }
        } catch (error) {
          console.error(`[ConsistencyRelay] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        resolve({ success: false, duplicate: false, message: `WebSocket error: ${JSON.stringify(error)}` });
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        // If we haven't resolved yet, it means we didn't get an OK response
        resolve({ success: false, duplicate: false, message: 'Connection closed without response' });
      };
    });
  }
}
