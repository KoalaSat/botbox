/**
 * Relay Manager for WebSocket connections to Nostr relays
 */

import { SimplePool, type Event as NostrEvent, type Filter } from 'nostr-tools';

// Default relays to use if user has no relay list
// Updated with more reliable and well-maintained relays as of 2026
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',           // Large, reliable relay
  'wss://nos.lol',                  // Fast and stable
  'wss://relay.primal.net',         // Primal's reliable relay
  'wss://nostr.wine',               // Popular relay
];

export class RelayManager {
  private pool: SimplePool;
  private relays: string[];

  constructor(relays?: string[]) {
    this.pool = new SimplePool();
    this.relays = relays && relays.length > 0 ? relays : DEFAULT_RELAYS;
  }

  /**
   * Get the list of relays being used
   */
  getRelays(): string[] {
    return [...this.relays];
  }

  /**
   * Add relays to the pool
   */
  addRelays(relays: string[]): void {
    const newRelays = relays.filter(r => !this.relays.includes(r));
    this.relays.push(...newRelays);
  }

  /**
   * Set relays (replaces current list)
   */
  setRelays(relays: string[]): void {
    this.relays = relays.length > 0 ? relays : DEFAULT_RELAYS;
  }

  /**
   * Fetch events from relays with better error handling and timeout protection
   */
  async fetchEvents(filters: Filter[], timeoutMs: number = 5000): Promise<NostrEvent[]> {
    try {
      console.log(`[RelayManager] Fetching events from ${this.relays.length} relays...`);
      
      // Add additional timeout wrapper to prevent hanging
      const fetchPromise = (async () => {
        // nostr-tools v2 querySync expects a single Filter, so we need to query each filter separately
        const allEvents: NostrEvent[] = [];
        for (const filter of filters) {
          const events = await this.pool.querySync(this.relays, filter, {
            maxWait: timeoutMs,
          });
          allEvents.push(...events);
        }
        return allEvents;
      })();

      // Race against timeout
      const timeoutPromise = new Promise<NostrEvent[]>((resolve) => {
        setTimeout(() => {
          console.warn(`[RelayManager] Fetch timed out after ${timeoutMs}ms, returning partial results`);
          resolve([]);
        }, timeoutMs + 2000); // Add 2s buffer to nostr-tools timeout
      });

      const allEvents = await Promise.race([fetchPromise, timeoutPromise]);
      
      console.log(`[RelayManager] Successfully fetched ${allEvents.length} events`);
      return allEvents;
    } catch (error) {
      console.error('[RelayManager] Error fetching events:', error);
      // Return empty array instead of throwing, allowing the app to continue
      return [];
    }
  }

  /**
   * Fetch a single event by ID
   */
  async fetchEventById(id: string, timeoutMs: number = 3000): Promise<NostrEvent | null> {
    const events = await this.fetchEvents([{ ids: [id] }], timeoutMs);
    return events[0] || null;
  }

  /**
   * Subscribe to events (returns a subscription ID)
   */
  subscribe(
    filters: Filter[],
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void,
    timeoutMs: number = 30000
  ): string {
    const subId = Math.random().toString(36).substring(7);
    
    console.log(`[RelayManager] Creating subscription ${subId} to ${this.relays.length} relays`);
    
    // For subscriptions with multiple filters, we need to merge them into a single filter
    // In practice, most subscriptions use a single filter
    const filter = filters.length === 1 ? filters[0] : this.mergeFilters(filters);
    
    // Set up timeout for subscription initialization
    const initTimeout = setTimeout(() => {
      console.warn(`[RelayManager] Subscription ${subId} initialization timeout - some relays may not have responded`);
    }, timeoutMs);
    
    let eoseCount = 0;
    const expectedRelays = this.relays.length;
    
    const sub = this.pool.subscribeMany(
      this.relays,
      filter,
      {
        onevent: (event) => {
          try {
            onEvent(event);
          } catch (error) {
            console.error('[RelayManager] Error in subscription event handler:', error);
          }
        },
        oneose: () => {
          eoseCount++;
          console.log(`[RelayManager] Subscription ${subId} EOSE from relay (${eoseCount}/${expectedRelays})`);
          
          // Clear timeout once we get first EOSE
          if (eoseCount === 1) {
            clearTimeout(initTimeout);
          }
          
          // Call onEose only after all relays have sent EOSE or timeout
          if (eoseCount >= expectedRelays) {
            console.log(`[RelayManager] Subscription ${subId} reached EOSE on all relays`);
            if (onEose) {
              try {
                onEose();
              } catch (error) {
                console.error('[RelayManager] Error in EOSE handler:', error);
              }
            }
          }
        },
      }
    );

    // Store subscription and timeout for cleanup
    (this as any)[`sub_${subId}`] = sub;
    (this as any)[`sub_${subId}_timeout`] = initTimeout;
    
    return subId;
  }

  /**
   * Merge multiple filters into a single filter (used for subscriptions)
   */
  private mergeFilters(filters: Filter[]): Filter {
    const merged: Filter = {};
    
    for (const filter of filters) {
      // Merge arrays
      if (filter.ids) merged.ids = [...(merged.ids || []), ...filter.ids];
      if (filter.authors) merged.authors = [...(merged.authors || []), ...filter.authors];
      if (filter.kinds) merged.kinds = [...(merged.kinds || []), ...filter.kinds];
      
      // Merge tag filters
      for (const key in filter) {
        if (key.startsWith('#')) {
          const tagKey = key as `#${string}`;
          merged[tagKey] = [...(merged[tagKey] || []), ...(filter[tagKey] || [])];
        }
      }
      
      // For since/until/limit, use the most permissive values
      if (filter.since !== undefined) {
        merged.since = merged.since !== undefined ? Math.min(merged.since, filter.since) : filter.since;
      }
      if (filter.until !== undefined) {
        merged.until = merged.until !== undefined ? Math.max(merged.until, filter.until) : filter.until;
      }
      if (filter.limit !== undefined) {
        merged.limit = merged.limit !== undefined ? Math.max(merged.limit, filter.limit) : filter.limit;
      }
    }
    
    return merged;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subId: string): void {
    const sub = (this as any)[`sub_${subId}`];
    const timeout = (this as any)[`sub_${subId}_timeout`];
    
    if (timeout) {
      clearTimeout(timeout);
      delete (this as any)[`sub_${subId}_timeout`];
    }
    
    if (sub) {
      try {
        sub.close();
      } catch (error) {
        console.error(`[RelayManager] Error closing subscription ${subId}:`, error);
      }
      delete (this as any)[`sub_${subId}`];
    }
  }

  /**
   * Publish an event to relays with retry logic
   */
  async publish(event: NostrEvent): Promise<void> {
    console.log(`[RelayManager] Publishing event to ${this.relays.length} relays...`);
    console.log(`[RelayManager] Event kind: ${event.kind}, id: ${event.id}`);
    console.log(`[RelayManager] Relays:`, this.relays);
    
    try {
      const publishPromises = this.pool.publish(this.relays, event);
      
      // Track individual relay results
      const results = await Promise.allSettled(publishPromises);
      
      let successCount = 0;
      let failureReasons: string[] = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`[RelayManager] ✓ Published to ${this.relays[index]}`);
          successCount++;
        } else {
          const reason = result.reason?.message || result.reason || 'Unknown error';
          console.error(`[RelayManager] ✗ Failed to publish to ${this.relays[index]}:`, reason);
          failureReasons.push(`${this.relays[index]}: ${reason}`);
        }
      });
      
      if (successCount === 0) {
        console.error('[RelayManager] All relays rejected the event:', failureReasons);
        throw new Error(`Failed to publish event to any relay (0/${this.relays.length} succeeded). Errors:\n${failureReasons.join('\n')}`);
      }
      
      console.log(`[RelayManager] Event published successfully to ${successCount}/${this.relays.length} relay(s)`);
    } catch (error) {
      console.error('[RelayManager] Failed to publish event:', error);
      throw error;
    }
  }

  /**
   * Test connectivity to relays and return healthy ones with timeout protection
   * This can be used to filter out non-responsive relays
   */
  async testRelayConnectivity(timeoutMs: number = 3000): Promise<string[]> {
    console.log(`[RelayManager] Testing connectivity to ${this.relays.length} relays...`);
    
    const healthyRelays: string[] = [];
    
    // Test each relay by attempting a simple query with race condition
    const testPromises = this.relays.map(async (relay) => {
      const testPromise = (async () => {
        try {
          // Create a temporary connection and test with a simple query
          const events = await this.pool.querySync([relay], { kinds: [0], limit: 1 }, {
            maxWait: timeoutMs,
          });
          
          console.log(`[RelayManager] ✓ Relay ${relay} is responsive`);
          return relay;
        } catch (error) {
          console.warn(`[RelayManager] ✗ Relay ${relay} failed connectivity test:`, error);
          return null;
        }
      })();

      // Race against timeout
      const timeoutPromise = new Promise<string | null>((resolve) => {
        setTimeout(() => {
          console.warn(`[RelayManager] ✗ Relay ${relay} connectivity test timed out`);
          resolve(null);
        }, timeoutMs + 1000); // Add 1s buffer
      });

      return Promise.race([testPromise, timeoutPromise]);
    });

    const results = await Promise.allSettled(testPromises);
    
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        healthyRelays.push(result.value);
      }
    });

    console.log(`[RelayManager] ${healthyRelays.length}/${this.relays.length} relays are healthy`);
    return healthyRelays;
  }

  /**
   * Remove unhealthy relays from the active relay list
   */
  async pruneUnhealthyRelays(timeoutMs: number = 3000): Promise<void> {
    const healthyRelays = await this.testRelayConnectivity(timeoutMs);
    
    if (healthyRelays.length === 0) {
      console.warn('[RelayManager] No healthy relays found, keeping all relays');
      return;
    }

    const removedCount = this.relays.length - healthyRelays.length;
    this.relays = healthyRelays;
    
    if (removedCount > 0) {
      console.log(`[RelayManager] Removed ${removedCount} unhealthy relay(s)`);
    }
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    try {
      // Clean up any pending timeouts
      const keys = Object.keys(this);
      keys.forEach(key => {
        if (key.includes('_timeout')) {
          const timeout = (this as any)[key];
          if (timeout) {
            clearTimeout(timeout);
            delete (this as any)[key];
          }
        }
      });

      this.pool.close(this.relays);
      console.log(`[RelayManager] Closed connections to ${this.relays.length} relays`);
    } catch (error) {
      console.error('[RelayManager] Error closing connections:', error);
    }
  }

  /**
   * Create a new relay manager with default relays
   */
  static createDefault(): RelayManager {
    return new RelayManager(DEFAULT_RELAYS);
  }
}
