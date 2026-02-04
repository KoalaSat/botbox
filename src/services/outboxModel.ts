/**
 * Outbox Model Service
 * Manages WebSocket connections to multiple relays based on user's relay list:
 * - Write relays: monitors events authored by the user
 * - Read relays: monitors events where the user is tagged
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

interface RelayConnection {
  ws: WebSocket;
  url: string;
  type: 'write' | 'read';
  reconnectAttempts: number;
  eoseReceived: boolean;
}

interface OutboxModelStatus {
  writeRelays: Array<{ url: string; connected: boolean; eoseReceived: boolean }>;
  readRelays: Array<{ url: string; connected: boolean; eoseReceived: boolean }>;
  totalConnected: number;
  totalRelays: number;
  totalEoseReceived: number;
}

/**
 * Outbox Model Service
 */
export class OutboxModelService {
  private connections: Map<string, RelayConnection> = new Map();
  private events: NostrEvent[] = [];
  private eventRelayMap: Map<string, Set<string>> = new Map(); // eventId -> Set of relay URLs
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_EVENTS_IN_MEMORY = 1000;
  private readonly BROADCAST_TIMEOUT = 10000; // 10 seconds

  constructor(private getRelayManager: () => Promise<RelayManager>) {}

  /**
   * Initialize connections on startup if user is logged in
   */
  async initialize(): Promise<void> {
    const userData = await Database.getUserData();
    if (!userData) {
      console.log('[OutboxModel] No user data, skipping initialization');
      return;
    }

    console.log('[OutboxModel] Initializing multi-relay connections');
    await this.connectToUserRelays(userData.pubkey);
  }

  /**
   * Connect to all user's write and read relays
   */
  async connectToUserRelays(pubkey: string): Promise<void> {
    // Disconnect any existing connections first
    this.disconnect();

    const rm = await this.getRelayManager();
    const relayListManager = new RelayListManager(rm);

    // Get all relay metadata to determine capabilities
    const relayMetadata = await relayListManager.getRelayList();
    console.log(`[OutboxModel] Connecting to ${relayMetadata.length} relays`);
    
    for (const relay of relayMetadata) {
      await this.connectToRelay(relay.url, pubkey, relay.type);
    }

    console.log(`[OutboxModel] Connected to ${this.connections.size} total relays`);
  }

  /**
   * Connect to a single relay
   */
  private async connectToRelay(url: string, pubkey: string, type: 'write' | 'read' | 'both'): Promise<void> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);

        const connection: RelayConnection = {
          ws,
          url,
          type: type === 'both' ? 'write' : type, // Store as 'write' for 'both' for backwards compatibility
          reconnectAttempts: 0,
          eoseReceived: false,
        };

        ws.onopen = () => {
          console.log(`[OutboxModel] Connected to ${type} relay:`, url);
          
          // Subscribe based on relay type
          // For 'write' or 'both': subscribe to user's authored events
          if (type === 'write' || type === 'both') {
            const subscriptionId = `outbox-authored-${Date.now()}-${Math.random()}`;
            const filter = { authors: [pubkey] };
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws.send(req);
            console.log(`[OutboxModel] Subscribed to authored events on ${url}`);
          }
          
          // For 'read' or 'both': subscribe to events where user is tagged
          if (type === 'read' || type === 'both') {
            const subscriptionId = `outbox-tagged-${Date.now()}-${Math.random()}`;
            const filter = { '#p': [pubkey] };
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws.send(req);
            console.log(`[OutboxModel] Subscribed to tagged events on ${url}`);
          }

          this.connections.set(url, connection);
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message, url);
          } catch (err) {
            console.error(`[OutboxModel] Error parsing message from ${url}:`, err);
          }
        };

        ws.onerror = (err) => {
          console.error(`[OutboxModel] WebSocket error on ${url}:`, err);
          resolve(); // Resolve anyway to not block other connections
        };

        ws.onclose = () => {
          console.log(`[OutboxModel] Disconnected from ${url}`);
          this.connections.delete(url);

          // Auto-reconnect if not manually disconnected
          this.attemptReconnect(url, pubkey, type, connection.reconnectAttempts);
        };
      } catch (err) {
        console.error(`[OutboxModel] Failed to connect to ${url}:`, err);
        resolve();
      }
    });
  }

  /**
   * Disconnect from all relays
   */
  disconnect(): void {
    console.log(`[OutboxModel] Disconnecting from ${this.connections.size} relays`);
    
    for (const [url, connection] of this.connections.entries()) {
      connection.reconnectAttempts = this.MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
      connection.ws.close();
    }
    
    this.connections.clear();
    this.events = [];
  }

  /**
   * Get connection status
   */
  getStatus(): OutboxModelStatus {
    const writeRelays: Array<{ url: string; connected: boolean; eoseReceived: boolean }> = [];
    const readRelays: Array<{ url: string; connected: boolean; eoseReceived: boolean }> = [];
    let totalConnected = 0;
    let totalEoseReceived = 0;

    for (const [url, connection] of this.connections.entries()) {
      const isConnected = connection.ws.readyState === WebSocket.OPEN;
      
      if (isConnected) {
        totalConnected++;
      }

      if (connection.eoseReceived) {
        totalEoseReceived++;
      }

      const relayStatus = { url, connected: isConnected, eoseReceived: connection.eoseReceived };
      
      if (connection.type === 'write') {
        writeRelays.push(relayStatus);
      } else {
        readRelays.push(relayStatus);
      }
    }

    return {
      writeRelays,
      readRelays,
      totalConnected,
      totalRelays: this.connections.size,
      totalEoseReceived,
    };
  }

  /**
   * Get received events
   */
  getEvents(): NostrEvent[] {
    return this.events;
  }

  /**
   * Get relay count for an event
   */
  getRelayCount(eventId: string): number {
    return this.eventRelayMap.get(eventId)?.size || 0;
  }

  /**
   * Get relay URLs for an event
   */
  getRelayUrls(eventId: string): string[] {
    return Array.from(this.eventRelayMap.get(eventId) || []);
  }

  /**
   * Attempt to reconnect to a relay
   */
  private async attemptReconnect(
    url: string,
    pubkey: string,
    type: 'write' | 'read' | 'both',
    currentAttempts: number
  ): Promise<void> {
    if (currentAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`[OutboxModel] Max reconnect attempts reached for ${url}`);
      return;
    }

    const nextAttempt = currentAttempts + 1;
    console.log(
      `[OutboxModel] Reconnecting to ${url} (attempt ${nextAttempt}/${this.MAX_RECONNECT_ATTEMPTS})...`
    );

    setTimeout(async () => {
      const userData = await Database.getUserData();
      if (userData) {
        await this.connectToRelay(url, userData.pubkey, type);
      }
    }, this.RECONNECT_DELAY);
  }

  /**
   * Handle messages from relays
   */
  private handleMessage(message: any[], relayUrl: string): void {
    const [type, ...args] = message;

    switch (type) {
      case 'EVENT':
        const [subscriptionId, event] = args;
        this.handleEvent(event, relayUrl);
        break;

      case 'EOSE':
        const connection = this.connections.get(relayUrl);
        if (connection) {
          connection.eoseReceived = true;
          console.log(`[OutboxModel] ✓ EOSE received from ${relayUrl}`);
        }
        break;

      case 'NOTICE':
        console.log(`[OutboxModel] Notice from ${relayUrl}:`, args[0]);
        break;
    }
  }

  /**
   * Handle incoming event
   */
  private async handleEvent(event: NostrEvent, relayUrl: string): Promise<void> {
    // Track which relay this event was seen on
    if (!this.eventRelayMap.has(event.id)) {
      this.eventRelayMap.set(event.id, new Set());
    }
    this.eventRelayMap.get(event.id)!.add(relayUrl);

    // Skip if event already exists (deduplication across relays)
    if (this.events.find((e) => e.id === event.id)) {
      return;
    }

    // Skip follow list events (kind 3) from other users
    const userData = await Database.getUserData();
    if (userData && event.kind === 3 && event.pubkey !== userData.pubkey) {
      console.log('[OutboxModel] Skipping follow list event from other user');
      return;
    }

    // Add event to memory
    this.events = [event, ...this.events];
    
    // Keep only last N events in memory
    if (this.events.length > this.MAX_EVENTS_IN_MEMORY) {
      this.events = this.events.slice(0, this.MAX_EVENTS_IN_MEMORY);
    }
    
    console.log(`[OutboxModel] New event received from ${relayUrl}:`, event.kind, event.id.substring(0, 8));

    // Broadcast event to appropriate relays
    this.broadcastEvent(event).catch((error) => {
      console.error('[OutboxModel] Failed to broadcast event:', error);
    });
  }

  /**
   * Broadcast event to appropriate relays based on event type
   * - User-authored events: broadcast to user's write relays + tagged users' read relays
   * - User-tagged events: broadcast to user's read relays
   * Special handling for Profile (kind 0) and Relay List (kind 10002) events:
   * these are broadcast to all read relays of all contacts in the user's follow list
   */
  private async broadcastEvent(event: NostrEvent): Promise<void> {
    try {
      console.log(
        '[OutboxModel] Broadcasting event',
        event.id.substring(0, 8),
        'kind:',
        event.kind
      );

      const userData = await Database.getUserData();
      if (!userData) {
        console.warn('[OutboxModel] No user data, cannot broadcast');
        return;
      }

      const rm = await this.getRelayManager();
      const relayListManager = new RelayListManager(rm);

      let allTargetRelays: string[] = [];

      // Check if this event has already been broadcast
      const alreadyBroadcast = await this.hasBeenBroadcast(event.id);
      if (alreadyBroadcast) {
        console.log('[OutboxModel] Event', event.id.substring(0, 8), 'already broadcast, skipping');
        return;
      }

      // Check if event was created before user's first login (don't broadcast old events)
      const firstLoginTimestamp = await Database.getFirstLoginTimestamp();
      if (firstLoginTimestamp && event.created_at < firstLoginTimestamp) {
        console.log(
          '[OutboxModel] Event created before first login (',
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
        console.log('[OutboxModel] User is tagged in event, broadcasting to inbox relays');
        const inboxRelays = await relayListManager.getReadRelays();
        console.log('[OutboxModel] User inbox relays:', inboxRelays.length);
        allTargetRelays = inboxRelays;
      } else if (isUserAuthor && (event.kind === 0 || event.kind === 10002)) {
        // Special handling for Profile (kind 0) and Relay List (kind 10002) events
        // authored by the user
        console.log('[OutboxModel] Special handling for Profile/Relay List event');
        
        // Get all contacts from user's follow list
        const contacts = userData.contacts || [];
        console.log('[OutboxModel] User has', contacts.length, 'contacts');

        if (contacts.length === 0) {
          console.warn('[OutboxModel] No contacts found, falling back to outbox relays');
          const outboxRelays = await relayListManager.getWriteRelays();
          allTargetRelays = outboxRelays;
        } else {
          // Collect all read relays for all contacts
          const contactsReadRelays = await this.collectReadRelaysForContacts(contacts, relayListManager);
          console.log('[OutboxModel] Collected', contactsReadRelays.length, 'read relays from contacts');
          
          // Also include user's own outbox relays
          const outboxRelays = await relayListManager.getWriteRelays();
          console.log('[OutboxModel] User outbox relays:', outboxRelays.length);
          
          // Combine and deduplicate
          allTargetRelays = [...new Set([...outboxRelays, ...contactsReadRelays])];
        }
      } else if (isUserAuthor) {
        // Normal broadcasting for user-authored events: user's write relays + tagged users' read relays
        console.log('[OutboxModel] Broadcasting user-authored event');
        
        // Get user's write relays (outbox)
        const outboxRelays = await relayListManager.getWriteRelays();
        console.log('[OutboxModel] User outbox relays:', outboxRelays.length);

        console.log('[OutboxModel] Tagged pubkeys:', taggedPubkeys.length);

        // Collect read relays for tagged pubkeys (inbox)
        const inboxRelays = await this.collectInboxRelays(taggedPubkeys, relayListManager);
        console.log('[OutboxModel] Tagged users inbox relays:', inboxRelays.length);

        // Combine and deduplicate all target relays
        allTargetRelays = [...new Set([...outboxRelays, ...inboxRelays])];
      } else {
        console.log('[OutboxModel] Event not relevant to user (not authored by or tagging user)');
        return;
      }

      // Exclude relays we're already connected to (no need to broadcast back)
      allTargetRelays = this.excludeConnectedRelays(allTargetRelays);

      console.log('[OutboxModel] Total target relays (deduplicated):', allTargetRelays.length);

      if (allTargetRelays.length === 0) {
        console.warn('[OutboxModel] No target relays found, cannot broadcast');
        return;
      }

      // Broadcast to all target relays
      await this.broadcastToMultipleRelays(allTargetRelays, event);
    } catch (error) {
      console.error('[OutboxModel] Error broadcasting event:', error);
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
   */
  private async collectReadRelaysForContacts(
    contacts: Array<{ pubkey: string; relay?: string }>,
    relayListManager: RelayListManager
  ): Promise<string[]> {
    if (contacts.length === 0) {
      return [];
    }

    console.log('[OutboxModel] Collecting read relays for', contacts.length, 'contacts...');
    const readRelaysSet = new Set<string>();

    // First, collect relay hints from the contact list
    contacts.forEach((contact) => {
      if (contact.relay) {
        readRelaysSet.add(contact.relay);
      }
    });
    console.log('[OutboxModel] Found', readRelaysSet.size, 'relay hints from contact list');

    // Then, fetch relay lists for all contacts in parallel
    const relayListPromises = contacts.map(async (contact) => {
      try {
        const relayMetadata = await relayListManager.fetchRelayList(contact.pubkey);
        const readRelays = relayMetadata
          .filter((r) => r.type === 'read' || r.type === 'both')
          .map((r) => r.url);
        return readRelays;
      } catch (error) {
        console.warn(
          '[OutboxModel] Failed to fetch relay list for contact',
          contact.pubkey.substring(0, 8),
          ':',
          error
        );
        return [];
      }
    });

    const allReadRelays = await Promise.all(relayListPromises);

    // Flatten and deduplicate
    allReadRelays.forEach((relays) => {
      relays.forEach((relay) => readRelaysSet.add(relay));
    });

    const uniqueRelays = Array.from(readRelaysSet);
    console.log('[OutboxModel] Deduplicated to', uniqueRelays.length, 'unique read relays');

    return uniqueRelays;
  }

  /**
   * Collect read relays (inbox) for tagged pubkeys
   */
  private async collectInboxRelays(
    pubkeys: string[],
    relayListManager: RelayListManager
  ): Promise<string[]> {
    if (pubkeys.length === 0) {
      return [];
    }

    const inboxRelaysSet = new Set<string>();

    const relayListPromises = pubkeys.map(async (pubkey) => {
      try {
        const relayMetadata = await relayListManager.fetchRelayList(pubkey);
        const readRelays = relayMetadata
          .filter((r) => r.type === 'read' || r.type === 'both')
          .map((r) => r.url);
        return readRelays;
      } catch (error) {
        console.warn(
          '[OutboxModel] Failed to fetch relay list for',
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
   */
  private async hasBeenBroadcast(eventId: string): Promise<boolean> {
    try {
      const key = 'broadcastHistory';
      const result = await chrome.storage.local.get(key);
      const history: string[] = result[key] || [];
      
      return history.includes(eventId);
    } catch (error) {
      console.error('[OutboxModel] Error checking broadcast history:', error);
      return false;
    }
  }

  /**
   * Mark an event as broadcast
   */
  private async markAsBroadcast(eventId: string): Promise<void> {
    try {
      const key = 'broadcastHistory';
      const result = await chrome.storage.local.get(key);
      const history: string[] = result[key] || [];
      
      if (!history.includes(eventId)) {
        history.unshift(eventId);
        
        // Keep only the last 1000 event IDs
        if (history.length > 1000) {
          history.splice(1000);
        }
        
        await chrome.storage.local.set({ [key]: history });
        console.log('[OutboxModel] Marked event', eventId.substring(0, 8), 'as broadcast');
      }
    } catch (error) {
      console.error('[OutboxModel] Error marking event as broadcast:', error);
    }
  }

  /**
   * Exclude connected relays from broadcast targets (no need to send back to source)
   */
  private excludeConnectedRelays(relays: string[]): string[] {
    const connectedUrls = Array.from(this.connections.keys());
    const beforeCount = relays.length;
    const filtered = relays.filter((url) => !connectedUrls.includes(url));
    
    if (beforeCount !== filtered.length) {
      console.log('[OutboxModel] Excluded', beforeCount - filtered.length, 'connected relays from broadcast targets');
    }
    
    return filtered;
  }

  /**
   * Broadcast to multiple relays
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
            console.log(`[OutboxModel] ℹ ${relayUrl} already had the event`);
          }
        } else {
          console.log(`[OutboxModel] ℹ ${relayUrl} failed: ${JSON.stringify(response.message)}`);
          failureCount++;
        }
      } else {
        failureCount++;
        console.error(
          `[OutboxModel] ✗ Failed to broadcast to ${relayUrl}:`,
          result.reason
        );
      }
    });

    console.log(
      `[OutboxModel] Broadcast complete: ${successCount} succeeded, ${duplicateCount} duplicates, ${failureCount} failed`
    );

    // Mark event as broadcast if at least one relay accepted it
    if (successCount > 0) {
      await this.markAsBroadcast(event.id);
    }
  }

  /**
   * Broadcast event to a single relay
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
        const eventMessage = JSON.stringify(['EVENT', event]);
        ws.send(eventMessage);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const [type, eventId, accepted, message] = data;

          if (type === 'OK' && eventId === event.id) {
            clearTimeout(timeout);
            ws.close();

            if (accepted) {
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
              console.warn(`[OutboxModel] ${relayUrl} rejected event:`, JSON.stringify(message));
              resolve({
                success: false,
                duplicate: false,
                message: JSON.stringify(message) || 'Event rejected',
              });
            }
          }
        } catch (error) {
          console.error(`[OutboxModel] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        resolve({ success: false, duplicate: false, message: `WebSocket error: ${JSON.stringify(error)}` });
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve({ success: false, duplicate: false, message: 'Connection closed without response' });
      };
    });
  }
}
