/**
 * Inbox Scanner Service
 * Periodically scans top relays for events tagging the user
 * and broadcasts discovered events to user's inbox relays
 */

import type { Event as NostrEvent } from 'nostr-tools';
import { Database } from './db';
import { RelayListManager } from './relayListManager';
import type { RelayManager } from './relayManager';

interface ScanResult {
  eventsFound: number;
  eventsBroadcast: number;
  relaysScanned: number;
  duration: number;
  timestamp: number;
}

interface DiscoveredEvent {
  event: NostrEvent;
  relaySource: string;
  discoveryTime: number;
  broadcastStatus: 'pending' | 'success' | 'failed';
  broadcastCount: number;
}

interface InboxScannerStatus {
  lastScanTime: number | null;
  totalEventsDiscovered: number;
  totalEventsBroadcast: number;
  isScanning: boolean;
}

/**
 * Inbox Scanner Service
 */
export class InboxScannerService {
  private readonly SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private readonly MAX_CONCURRENT_RELAYS = 10;
  private readonly SCAN_TIMEOUT_PER_RELAY = 10000; // 10 seconds
  private readonly BROADCAST_TIMEOUT = 10000; // 10 seconds
  private readonly TOP_RELAYS_API = 'https://api.nostr.watch/v1/public';
  private readonly MAX_TOP_RELAYS = 50;
  
  private isScanning = false;
  private scanHistory: ScanResult[] = [];

  constructor(private getRelayManager: () => Promise<RelayManager>) {}

  /**
   * Initialize scanner (manual mode - no automatic scanning)
   */
  async initialize(): Promise<void> {
    const userData = await Database.getUserData();
    if (!userData) {
      console.log('[InboxScanner] No user data, skipping initialization');
      return;
    }

    console.log('[InboxScanner] Inbox scanner initialized (manual mode only)');
  }

  /**
   * Get scanner status
   */
  async getStatus(): Promise<InboxScannerStatus> {
    const stats = await this.getStats();

    return {
      lastScanTime: stats.lastScanTime,
      totalEventsDiscovered: stats.totalEventsDiscovered,
      totalEventsBroadcast: stats.totalEventsBroadcast,
      isScanning: this.isScanning,
    };
  }

  /**
   * Get discovered events
   */
  async getDiscoveredEvents(): Promise<DiscoveredEvent[]> {
    try {
      const result = await chrome.storage.local.get('inboxScannerEvents');
      return result.inboxScannerEvents || [];
    } catch (error) {
      console.error('[InboxScanner] Error getting discovered events:', error);
      return [];
    }
  }

  /**
   * Perform a scan for events tagging the user
   */
  async performScan(): Promise<ScanResult> {
    if (this.isScanning) {
      console.log('[InboxScanner] Scan already in progress');
      throw new Error('Scan already in progress');
    }

    const userData = await Database.getUserData();
    if (!userData) {
      throw new Error('User not logged in');
    }

    this.isScanning = true;
    const startTime = Date.now();
    console.log('[InboxScanner] Starting scan for events tagging', userData.pubkey.substring(0, 8));

    // Reset counters at the start of each scan
    await this.resetStats();

    try {
      // Fetch top relays
      const topRelays = await this.fetchTopRelays();
      console.log(`[InboxScanner] Fetched ${topRelays.length} top relays`);

      // Scan relays for events tagging the user
      const newEvents = await this.scanRelaysForEvents(topRelays, userData.pubkey);
      console.log(`[InboxScanner] Found ${newEvents.length} new events`);

      // Update stats with discovered events immediately
      await this.incrementStats(newEvents.length, 0);

      // Broadcast new events to user's inbox relays
      let broadcastCount = 0;
      for (const discoveredEvent of newEvents) {
        try {
          console.log(`[InboxScanner] Broadcasting event ${discoveredEvent.event.id.substring(0, 8)}...`);
          const success = await this.broadcastToInbox(discoveredEvent.event);
          console.log(`[InboxScanner] Broadcast result for ${discoveredEvent.event.id.substring(0, 8)}: ${success}`);
          
          if (success) {
            discoveredEvent.broadcastStatus = 'success';
            broadcastCount++;
            // Update broadcast count incrementally
            console.log(`[InboxScanner] Incrementing broadcast count (now ${broadcastCount})`);
            await this.incrementStats(0, 1);
          } else {
            console.log(`[InboxScanner] Broadcast failed for ${discoveredEvent.event.id.substring(0, 8)}`);
            discoveredEvent.broadcastStatus = 'failed';
          }
        } catch (error) {
          console.error('[InboxScanner] Error broadcasting event:', error);
          discoveredEvent.broadcastStatus = 'failed';
        }
      }

      // Store discovered events
      await this.storeDiscoveredEvents(newEvents);

      // Update statistics
      const duration = Date.now() - startTime;
      const scanResult: ScanResult = {
        eventsFound: newEvents.length,
        eventsBroadcast: broadcastCount,
        relaysScanned: topRelays.length,
        duration,
        timestamp: Date.now(),
      };

      await this.updateStats(scanResult);
      this.scanHistory.unshift(scanResult);
      
      // Keep only last 20 scan results
      if (this.scanHistory.length > 20) {
        this.scanHistory = this.scanHistory.slice(0, 20);
      }

      console.log(
        `[InboxScanner] Scan complete: ${newEvents.length} events found, ${broadcastCount} broadcast in ${duration}ms`
      );

      return scanResult;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Fetch top relays from nostr.watch API
   */
  private async fetchTopRelays(): Promise<string[]> {
    try {
      const response = await fetch(this.TOP_RELAYS_API, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const relays = await response.json();
      
      // Sort by some metric (e.g., name or just take first N)
      const topRelayUrls = relays
        .slice(0, this.MAX_TOP_RELAYS)
        .map((relay: any) => relay.url || relay)
        .filter((url: string) => url.startsWith('wss://') || url.startsWith('ws://'));

      return topRelayUrls;
    } catch (error) {
      console.error('[InboxScanner] Error fetching top relays:', error);
      // Fallback to hardcoded list of popular relays
      return this.getFallbackRelays();
    }
  }

  /**
   * Fallback list of popular relays
   */
  private getFallbackRelays(): string[] {
    return [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://nostr.wine',
      'wss://relay.snort.social',
      'wss://nostr-pub.wellorder.net',
      'wss://relay.current.fyi',
      'wss://nostr.mom',
      'wss://relay.nostr.info',
      'wss://relay.orangepill.dev',
      'wss://eden.nostr.land',
      'wss://nostr.fmt.wiz.biz',
      'wss://relay.nostrati.com',
      'wss://purplepag.es',
      'wss://relay.westernbtc.com',
      'wss://nostr21.com',
      'wss://nostr.btcpay.tech',
      'wss://relay.nostr.bg',
      'wss://nostr.zebedee.cloud',
    ];
  }

  /**
   * Scan relays for events tagging the user
   */
  private async scanRelaysForEvents(
    relays: string[],
    userPubkey: string
  ): Promise<DiscoveredEvent[]> {
    const discoveredEvents: DiscoveredEvent[] = [];
    const seenEventIds = await this.getSeenEventIds();

    // Process relays in batches to avoid overwhelming connections
    for (let i = 0; i < relays.length; i += this.MAX_CONCURRENT_RELAYS) {
      const batch = relays.slice(i, i + this.MAX_CONCURRENT_RELAYS);
      const batchPromises = batch.map((relay) =>
        this.scanSingleRelay(relay, userPubkey, seenEventIds)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          discoveredEvents.push(...result.value);
        }
      }
    }

    return discoveredEvents;
  }

  /**
   * Scan a single relay for events
   */
  private async scanSingleRelay(
    relayUrl: string,
    userPubkey: string,
    seenEventIds: Set<string>
  ): Promise<DiscoveredEvent[]> {
    return new Promise((resolve) => {
      const events: DiscoveredEvent[] = [];
      const timeout = setTimeout(() => {
        ws.close();
        resolve(events);
      }, this.SCAN_TIMEOUT_PER_RELAY);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeout);
        resolve(events);
        return;
      }

      ws.onopen = () => {
        // Subscribe to events tagging the user
        const subscriptionId = `inbox-scan-${Date.now()}-${Math.random()}`;
        const filter = {
          '#p': [userPubkey],
          limit: 100, // Limit to recent events
        };
        const req = JSON.stringify(['REQ', subscriptionId, filter]);
        ws.send(req);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const [type, ...args] = data;

          if (type === 'EVENT') {
            const [, event] = args;
            
            // Check if we've already seen this event
            if (!seenEventIds.has(event.id)) {
              events.push({
                event,
                relaySource: relayUrl,
                discoveryTime: Date.now(),
                broadcastStatus: 'pending',
                broadcastCount: 0,
              });
              seenEventIds.add(event.id);
            }
          } else if (type === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        } catch (error) {
          console.error(`[InboxScanner] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    });
  }

  /**
   * Broadcast event to user's inbox relays
   */
  private async broadcastToInbox(event: NostrEvent): Promise<boolean> {
    try {
      const rm = await this.getRelayManager();
      const relayListManager = new RelayListManager(rm);
      const inboxRelays = await relayListManager.getReadRelays();

      if (inboxRelays.length === 0) {
        console.warn('[InboxScanner] No inbox relays found');
        return false;
      }

      console.log(`[InboxScanner] Broadcasting event ${event.id.substring(0, 8)} to ${inboxRelays.length} inbox relays`);

      const broadcastPromises = inboxRelays.map((relayUrl) =>
        this.broadcastToSingleRelay(relayUrl, event)
      );

      const results = await Promise.allSettled(broadcastPromises);
      const successCount = results.filter(
        (r) => r.status === 'fulfilled' && r.value
      ).length;

      return successCount > 0;
    } catch (error) {
      console.error('[InboxScanner] Error broadcasting to inbox:', error);
      return false;
    }
  }

  /**
   * Broadcast event to a single relay
   */
  private async broadcastToSingleRelay(
    relayUrl: string,
    event: NostrEvent
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, this.BROADCAST_TIMEOUT);

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeout);
        resolve(false);
        return;
      }

      ws.onopen = () => {
        const eventMessage = JSON.stringify(['EVENT', event]);
        ws.send(eventMessage);
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const [type, eventId, accepted] = data;

          if (type === 'OK' && eventId === event.id) {
            clearTimeout(timeout);
            ws.close();
            resolve(accepted);
          }
        } catch (error) {
          console.error(`[InboxScanner] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  }

  /**
   * Get seen event IDs
   */
  private async getSeenEventIds(): Promise<Set<string>> {
    try {
      const result = await chrome.storage.local.get('inboxScannerSeenEvents');
      const seenEvents: string[] = result.inboxScannerSeenEvents || [];
      return new Set(seenEvents);
    } catch (error) {
      console.error('[InboxScanner] Error getting seen events:', error);
      return new Set();
    }
  }

  /**
   * Store discovered events
   */
  private async storeDiscoveredEvents(events: DiscoveredEvent[]): Promise<void> {
    try {
      // Get existing events
      const existingEvents = await this.getDiscoveredEvents();
      
      // Add new events
      const allEvents = [...events, ...existingEvents];
      
      // Keep only last 500 events
      const limitedEvents = allEvents.slice(0, 500);
      
      await chrome.storage.local.set({ inboxScannerEvents: limitedEvents });

      // Update seen event IDs
      const seenEventIds = await this.getSeenEventIds();
      events.forEach((e) => seenEventIds.add(e.event.id));
      
      const seenArray = Array.from(seenEventIds);
      // Keep only last 5000 seen IDs
      const limitedSeen = seenArray.slice(0, 5000);
      
      await chrome.storage.local.set({ inboxScannerSeenEvents: limitedSeen });
    } catch (error) {
      console.error('[InboxScanner] Error storing discovered events:', error);
    }
  }

  /**
   * Get scanner configuration
   */
  private async getConfig(): Promise<{ enabled: boolean }> {
    try {
      const result = await chrome.storage.local.get('inboxScannerConfig');
      return result.inboxScannerConfig || { enabled: false };
    } catch (error) {
      console.error('[InboxScanner] Error getting config:', error);
      return { enabled: false };
    }
  }

  /**
   * Get scanner statistics
   */
  private async getStats(): Promise<{
    lastScanTime: number | null;
    totalEventsDiscovered: number;
    totalEventsBroadcast: number;
  }> {
    try {
      const result = await chrome.storage.local.get('inboxScannerStats');
      return (
        result.inboxScannerStats || {
          lastScanTime: null,
          totalEventsDiscovered: 0,
          totalEventsBroadcast: 0,
        }
      );
    } catch (error) {
      console.error('[InboxScanner] Error getting stats:', error);
      return {
        lastScanTime: null,
        totalEventsDiscovered: 0,
        totalEventsBroadcast: 0,
      };
    }
  }

  /**
   * Reset scanner statistics (called at the start of each scan)
   */
  private async resetStats(): Promise<void> {
    try {
      const updatedStats = {
        lastScanTime: null,
        totalEventsDiscovered: 0,
        totalEventsBroadcast: 0,
      };

      await chrome.storage.local.set({ inboxScannerStats: updatedStats });
      console.log('[InboxScanner] Stats reset to 0');
    } catch (error) {
      console.error('[InboxScanner] Error resetting stats:', error);
    }
  }

  /**
   * Increment scanner statistics (for real-time updates)
   */
  private async incrementStats(eventsDiscovered: number, eventsBroadcast: number): Promise<void> {
    try {
      const currentStats = await this.getStats();
      
      const updatedStats = {
        lastScanTime: currentStats.lastScanTime,
        totalEventsDiscovered: currentStats.totalEventsDiscovered + eventsDiscovered,
        totalEventsBroadcast: currentStats.totalEventsBroadcast + eventsBroadcast,
      };

      await chrome.storage.local.set({ inboxScannerStats: updatedStats });
    } catch (error) {
      console.error('[InboxScanner] Error incrementing stats:', error);
    }
  }

  /**
   * Update scanner statistics
   */
  private async updateStats(scanResult: ScanResult): Promise<void> {
    try {
      const currentStats = await this.getStats();
      
      const updatedStats = {
        lastScanTime: scanResult.timestamp,
        totalEventsDiscovered: currentStats.totalEventsDiscovered,
        totalEventsBroadcast: currentStats.totalEventsBroadcast,
      };

      await chrome.storage.local.set({ inboxScannerStats: updatedStats });
    } catch (error) {
      console.error('[InboxScanner] Error updating stats:', error);
    }
  }

  /**
   * Toggle scanner enabled/disabled
   */
  async toggleEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    const newEnabled = !config.enabled;
    
    await chrome.storage.local.set({
      inboxScannerConfig: { enabled: newEnabled },
    });

    if (newEnabled) {
      await this.initialize();
    } else {
      await chrome.alarms.clear('inboxScan');
    }

    return newEnabled;
  }

  /**
   * Get scan history
   */
  getScanHistory(): ScanResult[] {
    return this.scanHistory;
  }
}
