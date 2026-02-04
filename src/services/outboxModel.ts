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
  connectionTimeout?: ReturnType<typeof setTimeout>;
  lastError?: string;
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
  private failedRelays: Map<string, { attempts: number; lastAttempt: number; lastError?: string }> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  private readonly RECONNECT_DELAY = 5000; // 5 seconds
  private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds for initial connection
  private readonly MAX_EVENTS_IN_MEMORY = 1000;
  private readonly BROADCAST_TIMEOUT = 10000; // 10 seconds
  private readonly FAILED_RELAY_RETRY_DELAY = 60000; // 1 minute before retrying failed relays
  
  // Batching configuration
  private readonly BATCH_INTERVAL = 2000; // 2 seconds - collect events for this duration
  private readonly BATCH_MAX_SIZE = 50; // Max events per batch
  private eventBatch: NostrEvent[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

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
   * Connect to a single relay with timeout protection
   */
  private async connectToRelay(url: string, pubkey: string, type: 'write' | 'read' | 'both'): Promise<void> {
    // Check if already connected
    if (this.connections.has(url)) {
      console.log(`[OutboxModel] Already connected to ${url}, skipping`);
      return;
    }

    // Check if relay has recently failed
    const failedInfo = this.failedRelays.get(url);
    if (failedInfo && failedInfo.attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      const timeSinceLastAttempt = Date.now() - failedInfo.lastAttempt;
      if (timeSinceLastAttempt < this.FAILED_RELAY_RETRY_DELAY) {
        console.log(`[OutboxModel] Skipping ${url} - recently failed (retry in ${Math.round((this.FAILED_RELAY_RETRY_DELAY - timeSinceLastAttempt) / 1000)}s)`);
        return;
      } else {
        // Reset failed relay after retry delay
        console.log(`[OutboxModel] Retry delay expired for ${url}, attempting reconnection`);
        this.failedRelays.delete(url);
      }
    }

    return new Promise((resolve) => {
      let connectionTimeout: ReturnType<typeof setTimeout> | undefined;
      let ws: WebSocket | undefined;
      let isResolved = false;

      const resolveOnce = () => {
        if (!isResolved) {
          isResolved = true;
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = undefined;
          }
          resolve();
        }
      };

      // Set connection timeout
      connectionTimeout = setTimeout(() => {
        console.error(`[OutboxModel] Connection timeout for ${url}`);
        this.markRelayAsFailed(url, 'Connection timeout');
        if (ws) {
          try {
            if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          } catch (err) {
            // Ignore close errors
          }
        }
        resolveOnce();
      }, this.CONNECTION_TIMEOUT);

      try {
        ws = new WebSocket(url);

        const connection: RelayConnection = {
          ws,
          url,
          type: type === 'both' ? 'write' : type, // Store as 'write' for 'both' for backwards compatibility
          reconnectAttempts: 0,
          eoseReceived: false,
          connectionTimeout,
        };

        ws.onopen = () => {
          console.log(`[OutboxModel] Connected to ${type} relay:`, url);
          
          // Clear the connection timeout reference in the connection object
          if (connection.connectionTimeout) {
            clearTimeout(connection.connectionTimeout);
            connection.connectionTimeout = undefined;
          }
          
          // Subscribe based on relay type
          // For 'write' or 'both': subscribe to user's authored events
          if (type === 'write' || type === 'both') {
            const subscriptionId = `outbox-authored-${Date.now()}-${Math.random()}`;
            const filter = { authors: [pubkey] };
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws!.send(req);
            console.log(`[OutboxModel] Subscribed to authored events on ${url}`);
          }
          
          // For 'read' or 'both': subscribe to events where user is tagged
          if (type === 'read' || type === 'both') {
            const subscriptionId = `outbox-tagged-${Date.now()}-${Math.random()}`;
            const filter = { 
              '#p': [pubkey],
              kinds: [1, 4, 5, 6, 7, 9735, 30023], 
            };
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws!.send(req);
            console.log(`[OutboxModel] Subscribed to tagged events on ${url}`);
          }

          this.connections.set(url, connection);
          resolveOnce();
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
          const errorMsg = err instanceof ErrorEvent ? err.message : 'Connection error';
          console.error(`[OutboxModel] WebSocket error on ${url}:`, errorMsg);
          this.markRelayAsFailed(url, errorMsg);
          resolveOnce();
        };

        ws.onclose = (event) => {
          console.log(`[OutboxModel] Disconnected from ${url} (code: ${event.code}, reason: ${event.reason})`);
          
          const conn = this.connections.get(url);
          
          // Clear timeout if exists in connection
          if (conn && conn.connectionTimeout) {
            clearTimeout(conn.connectionTimeout);
            conn.connectionTimeout = undefined;
          }
          
          this.connections.delete(url);

          // Check the failedRelays map for the actual attempt count
          const failedInfo = this.failedRelays.get(url);
          const currentAttempts = failedInfo?.attempts || 0;

          // Only auto-reconnect if it's not a manual disconnect and not a fatal error
          // Code 1000 = normal closure, 1001 = going away
          const shouldReconnect = currentAttempts < this.MAX_RECONNECT_ATTEMPTS && 
                                  event.code !== 1000 && event.code !== 1001;
          
          if (shouldReconnect) {
            this.attemptReconnect(url, pubkey, type, currentAttempts);
          } else if (event.code !== 1000 && event.code !== 1001) {
            this.markRelayAsFailed(url, `Connection closed with code ${event.code}`);
          }
          
          resolveOnce();
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[OutboxModel] Failed to connect to ${url}:`, errorMsg);
        this.markRelayAsFailed(url, errorMsg);
        resolveOnce();
      }
    });
  }

  /**
   * Disconnect from all relays
   */
  disconnect(): void {
    console.log(`[OutboxModel] Disconnecting from ${this.connections.size} relays`);
    
    // Clear batch timer and flush pending events
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Flush any pending events in the batch
    if (this.eventBatch.length > 0) {
      console.log(`[OutboxModel] Flushing ${this.eventBatch.length} pending events before disconnect`);
      this.processBatch().catch(err => {
        console.error('[OutboxModel] Error flushing batch on disconnect:', err);
      });
    }
    
    for (const [url, connection] of this.connections.entries()) {
      connection.reconnectAttempts = this.MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
      
      // Clear connection timeout if exists
      if (connection.connectionTimeout) {
        clearTimeout(connection.connectionTimeout);
      }
      
      try {
        if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
          connection.ws.close(1000, 'Manual disconnect'); // Normal closure
        }
      } catch (err) {
        console.error(`[OutboxModel] Error closing connection to ${url}:`, err);
      }
    }
    
    this.connections.clear();
    this.events = [];
    this.eventBatch = [];
  }

  /**
   * Get connection status including failed relays
   */
  getStatus(): OutboxModelStatus & { failedRelays?: Array<{ url: string; attempts: number; lastError?: string }> } {
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

    // Include failed relays info
    const failedRelaysList = Array.from(this.failedRelays.entries()).map(([url, info]) => ({
      url,
      attempts: info.attempts,
      lastError: info.lastError,
    }));

    return {
      writeRelays,
      readRelays,
      totalConnected,
      totalRelays: this.connections.size,
      totalEoseReceived,
      failedRelays: failedRelaysList.length > 0 ? failedRelaysList : undefined,
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
   * Mark a relay as failed
   */
  private markRelayAsFailed(url: string, error?: string): void {
    const failedInfo = this.failedRelays.get(url) || { attempts: 0, lastAttempt: 0 };
    failedInfo.attempts++;
    failedInfo.lastAttempt = Date.now();
    failedInfo.lastError = error;
    this.failedRelays.set(url, failedInfo);
    
    if (failedInfo.attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[OutboxModel] Relay ${url} marked as failed after ${failedInfo.attempts} attempts. Last error: ${error}`);
    }
  }

  /**
   * Attempt to reconnect to a relay with exponential backoff
   */
  private async attemptReconnect(
    url: string,
    pubkey: string,
    type: 'write' | 'read' | 'both',
    currentAttempts: number
  ): Promise<void> {
    if (currentAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`[OutboxModel] Max reconnect attempts reached for ${url}`);
      this.markRelayAsFailed(url, 'Max reconnect attempts reached');
      return;
    }

    const nextAttempt = currentAttempts + 1;
    // Exponential backoff: 5s, 10s, 20s
    const delay = this.RECONNECT_DELAY * Math.pow(2, currentAttempts);
    
    console.log(
      `[OutboxModel] Will reconnect to ${url} in ${delay / 1000}s (attempt ${nextAttempt}/${this.MAX_RECONNECT_ATTEMPTS})`
    );

    setTimeout(async () => {
      const userData = await Database.getUserData();
      if (userData) {
        // Update the reconnect attempt counter before connecting
        const failedInfo = this.failedRelays.get(url) || { attempts: 0, lastAttempt: Date.now() };
        failedInfo.attempts = nextAttempt;
        this.failedRelays.set(url, failedInfo);
        
        await this.connectToRelay(url, userData.pubkey, type);
      }
    }, delay);
  }

  /**
   * Get list of failed relays
   */
  getFailedRelays(): Array<{ url: string; attempts: number; lastError?: string }> {
    return Array.from(this.failedRelays.entries()).map(([url, info]) => ({
      url,
      attempts: info.attempts,
      lastError: info.lastError,
    }));
  }

  /**
   * Clear failed relay status (allows retry)
   */
  clearFailedRelay(url: string): void {
    this.failedRelays.delete(url);
    console.log(`[OutboxModel] Cleared failed status for ${url}`);
  }

  /**
   * Clear all failed relay statuses
   */
  clearAllFailedRelays(): void {
    const count = this.failedRelays.size;
    this.failedRelays.clear();
    console.log(`[OutboxModel] Cleared ${count} failed relay statuses`);
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

    // Add event to batch for broadcasting
    this.addEventToBatch(event);
  }

  /**
   * Add event to batch for broadcasting
   */
  private addEventToBatch(event: NostrEvent): void {
    // Check if event is already in batch
    if (this.eventBatch.find((e) => e.id === event.id)) {
      return;
    }

    this.eventBatch.push(event);
    console.log(`[OutboxModel] Added event to batch (${this.eventBatch.length}/${this.BATCH_MAX_SIZE})`);

    // If batch is full, process immediately
    if (this.eventBatch.length >= this.BATCH_MAX_SIZE) {
      console.log('[OutboxModel] Batch full, processing immediately');
      this.flushBatch();
      return;
    }

    // Otherwise, schedule batch processing if not already scheduled
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatch();
      }, this.BATCH_INTERVAL);
      console.log(`[OutboxModel] Batch timer set for ${this.BATCH_INTERVAL}ms`);
    }
  }

  /**
   * Flush and process the current batch
   */
  private flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.eventBatch.length === 0) {
      return;
    }

    const batchToProcess = [...this.eventBatch];
    this.eventBatch = [];

    console.log(`[OutboxModel] Processing batch of ${batchToProcess.length} events`);
    
    this.processBatch(batchToProcess).catch((error) => {
      console.error('[OutboxModel] Failed to process batch:', error);
    });
  }

  /**
   * Process a batch of events for broadcasting
   */
  private async processBatch(batch?: NostrEvent[]): Promise<void> {
    const eventsToProcess = batch || this.eventBatch;
    
    if (eventsToProcess.length === 0) {
      return;
    }

    console.log(`[OutboxModel] Broadcasting batch of ${eventsToProcess.length} events`);

    try {
      const userData = await Database.getUserData();
      if (!userData) {
        console.warn('[OutboxModel] No user data, cannot broadcast batch');
        return;
      }

      const rm = await this.getRelayManager();
      const relayListManager = new RelayListManager(rm);

      // Group events by their target relays to optimize broadcasting
      const relayToEventsMap = new Map<string, NostrEvent[]>();

      for (const event of eventsToProcess) {
        const targetRelays = await this.determineTargetRelays(event, userData, relayListManager);
        
        for (const relayUrl of targetRelays) {
          if (!relayToEventsMap.has(relayUrl)) {
            relayToEventsMap.set(relayUrl, []);
          }
          relayToEventsMap.get(relayUrl)!.push(event);
        }
      }

      console.log(`[OutboxModel] Broadcasting to ${relayToEventsMap.size} unique relays`);

      // Broadcast all events to each relay
      const broadcastPromises: Promise<void>[] = [];

      for (const [relayUrl, events] of relayToEventsMap.entries()) {
        broadcastPromises.push(
          this.broadcastMultipleEventsToRelay(relayUrl, events)
        );
      }

      await Promise.allSettled(broadcastPromises);
      
      console.log('[OutboxModel] Batch broadcast complete');
    } catch (error) {
      console.error('[OutboxModel] Error processing batch:', error);
    }
  }

  /**
   * Determine target relays for an event
   */
  private async determineTargetRelays(
    event: NostrEvent,
    userData: { pubkey: string; contacts?: Array<{ pubkey: string; relay?: string }> },
    relayListManager: RelayListManager
  ): Promise<string[]> {
    // Check if event has already been broadcast
    const alreadyBroadcast = await this.hasBeenBroadcast(event.id);
    if (alreadyBroadcast) {
      console.log('[OutboxModel] Event', event.id.substring(0, 8), 'already broadcast, skipping');
      return [];
    }

    // Check if event was created before user's first login
    const firstLoginTimestamp = await Database.getFirstLoginTimestamp();
    if (firstLoginTimestamp && event.created_at < firstLoginTimestamp) {
      console.log(
        '[OutboxModel] Event created before first login, skipping broadcast'
      );
      return [];
    }

    const isUserAuthor = event.pubkey === userData.pubkey;
    const taggedPubkeys = this.extractTaggedPubkeys(event);
    const isUserTagged = taggedPubkeys.includes(userData.pubkey);

    let allTargetRelays: string[] = [];

    if (!isUserAuthor && isUserTagged) {
      // Event where user is tagged (but not authored by user)
      const inboxRelays = await relayListManager.getReadRelays();
      allTargetRelays = inboxRelays;
    } else if (isUserAuthor && (event.kind === 0 || event.kind === 10002)) {
      // Special handling for Profile (kind 0) and Relay List (kind 10002) events
      const contacts = userData.contacts || [];

      if (contacts.length === 0) {
        const outboxRelays = await relayListManager.getWriteRelays();
        allTargetRelays = outboxRelays;
      } else {
        const contactsReadRelays = await this.collectReadRelaysForContacts(contacts, relayListManager);
        const outboxRelays = await relayListManager.getWriteRelays();
        allTargetRelays = [...new Set([...outboxRelays, ...contactsReadRelays])];
      }
    } else if (isUserAuthor) {
      // Normal broadcasting for user-authored events
      const outboxRelays = await relayListManager.getWriteRelays();
      const inboxRelays = await this.collectInboxRelays(taggedPubkeys, relayListManager);
      allTargetRelays = [...new Set([...outboxRelays, ...inboxRelays])];
    } else {
      return [];
    }

    // Exclude relays we're already connected to
    allTargetRelays = this.excludeConnectedRelays(allTargetRelays);

    return allTargetRelays;
  }

  /**
   * Broadcast multiple events to a single relay
   */
  private async broadcastMultipleEventsToRelay(
    relayUrl: string,
    events: NostrEvent[]
  ): Promise<void> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      let isResolved = false;
      const eventsSent = new Set<string>();
      const eventsAcknowledged = new Set<string>();
      
      const resolveOnce = () => {
        if (!isResolved) {
          isResolved = true;
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        if (ws) {
          try {
            ws.close();
          } catch (err) {
            // Ignore close errors
          }
        }
        console.warn(`[OutboxModel] Timeout broadcasting ${events.length} events to ${relayUrl}`);
        resolveOnce();
      }, this.BROADCAST_TIMEOUT);

      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeout);
        console.error(`[OutboxModel] Failed to connect to ${relayUrl}:`, error);
        resolveOnce();
        return;
      }

      ws.onopen = () => {
        // Send all events
        for (const event of events) {
          const eventMessage = JSON.stringify(['EVENT', event]);
          ws.send(eventMessage);
          eventsSent.add(event.id);
        }
        console.log(`[OutboxModel] Sent ${events.length} events to ${relayUrl}`);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const [type, eventId, accepted, message] = data;

          if (type === 'OK') {
            eventsAcknowledged.add(eventId);
            
            if (accepted) {
              // Mark event as broadcast
              this.markAsBroadcast(eventId).catch(err => {
                console.error('[OutboxModel] Error marking event as broadcast:', err);
              });
            } else {
              console.warn(`[OutboxModel] ${relayUrl} rejected event ${eventId.substring(0, 8)}:`, message);
            }

            // If all events acknowledged, close connection
            if (eventsAcknowledged.size === eventsSent.size) {
              clearTimeout(timeout);
              ws.close();
              console.log(`[OutboxModel] All ${eventsAcknowledged.size} events acknowledged by ${relayUrl}`);
              resolveOnce();
            }
          }
        } catch (error) {
          console.error(`[OutboxModel] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        const errorMsg = error instanceof ErrorEvent ? error.message : 'WebSocket error';
        console.error(`[OutboxModel] Error broadcasting to ${relayUrl}:`, errorMsg);
        resolveOnce();
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolveOnce();
      };
    });
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
      // Handle Firefox compatibility: result might be undefined
      if (!result || typeof result !== 'object') {
        return false;
      }
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
      // Handle Firefox compatibility: result might be undefined
      if (!result || typeof result !== 'object') {
        await chrome.storage.local.set({ [key]: [eventId] });
        console.log('[OutboxModel] Marked event', eventId.substring(0, 8), 'as broadcast');
        return;
      }
      
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

}
