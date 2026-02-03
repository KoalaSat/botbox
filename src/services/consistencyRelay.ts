/**
 * Consistency Relay Service
 * Manages WebSocket connection to a consistency relay and broadcasts events
 * to user's outbox relays and tagged users' inbox relays
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
  private handleEvent(event: NostrEvent): void {
    // Add event if it doesn't exist
    if (!this.events.find((e) => e.id === event.id)) {
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

      // Special handling for Profile (kind 0) and Relay List (kind 10002) events
      if (event.kind === 0 || event.kind === 10002) {
        console.log('[ConsistencyRelay] Special handling for Profile/Relay List event');
        
        // Check if we have a previous record of this event type
        const hasPreyiousRecord = await this.hasPreviousEventRecord(event.kind);
        
        if (!hasPreyiousRecord) {
          // First time seeing this event type - just store it, don't broadcast
          console.log('[ConsistencyRelay] First time seeing kind', event.kind, '- storing without broadcast');
          await this.storeEventTimestamp(event);
          return;
        }
        
        // Check if this event is newer than the last one we broadcast
        const isNewEvent = await this.isNewerEvent(event);
        if (!isNewEvent) {
          console.log('[ConsistencyRelay] Event is not newer than previously seen, skipping broadcast');
          return;
        }
        
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
        
        // Store this event's timestamp for future comparison
        await this.storeEventTimestamp(event);
      } else {
        // Normal broadcasting: user's outbox + tagged users' inbox relays
        // Get user's outbox relays (write relays)
        const outboxRelays = await relayListManager.getWriteRelays();
        console.log('[ConsistencyRelay] User outbox relays:', outboxRelays);

        // Extract tagged pubkeys
        const taggedPubkeys = this.extractTaggedPubkeys(event);
        console.log('[ConsistencyRelay] Tagged pubkeys:', taggedPubkeys.length);

        // Collect inbox relays for tagged pubkeys
        const inboxRelays = await this.collectInboxRelays(taggedPubkeys, relayListManager);
        console.log('[ConsistencyRelay] Tagged users inbox relays:', inboxRelays.length);

        // Combine and deduplicate all target relays
        allTargetRelays = [...new Set([...outboxRelays, ...inboxRelays])];
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
        // Fetch relay list with network skip for faster response (uses local cache)
        const relayMetadata = await relayListManager.fetchRelayList(contact.pubkey, true);
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
        // Fetch relay list with network skip for faster response
        const relayMetadata = await relayListManager.fetchRelayList(pubkey, true);
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
   * Check if we have a previous record of events for a given kind
   * Returns true if we have seen this event kind before, false otherwise
   */
  private async hasPreviousEventRecord(kind: number): Promise<boolean> {
    try {
      const key = `lastEventTimestamp_kind${kind}`;
      const result = await chrome.storage.local.get(key);
      const lastTimestamp = result[key];
      
      return lastTimestamp !== undefined && lastTimestamp !== null;
    } catch (error) {
      console.error('[ConsistencyRelay] Error checking previous event record:', error);
      return false;
    }
  }

  /**
   * Check if an event is newer than the last one we've seen for its kind
   * Returns true if this is the first event or if it's newer than the last one
   */
  private async isNewerEvent(event: NostrEvent): Promise<boolean> {
    try {
      const key = `lastEventTimestamp_kind${event.kind}`;
      const result = await chrome.storage.local.get(key);
      const lastTimestamp = result[key];
      
      if (!lastTimestamp) {
        console.log('[ConsistencyRelay] First event of kind', event.kind);
        return true;
      }
      
      if (event.created_at > lastTimestamp) {
        console.log('[ConsistencyRelay] Event is newer:', event.created_at, '>', lastTimestamp);
        return true;
      }
      
      console.log('[ConsistencyRelay] Event is not newer:', event.created_at, '<=', lastTimestamp);
      return false;
    } catch (error) {
      console.error('[ConsistencyRelay] Error checking event timestamp:', error);
      // In case of error, allow the broadcast
      return true;
    }
  }

  /**
   * Store the timestamp of an event for future comparison
   */
  private async storeEventTimestamp(event: NostrEvent): Promise<void> {
    try {
      const key = `lastEventTimestamp_kind${event.kind}`;
      await chrome.storage.local.set({ [key]: event.created_at });
      console.log('[ConsistencyRelay] Stored timestamp for kind', event.kind, ':', event.created_at);
    } catch (error) {
      console.error('[ConsistencyRelay] Error storing event timestamp:', error);
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
