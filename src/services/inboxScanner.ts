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
  private readonly MAX_CONCURRENT_RELAYS = 10;
  private readonly SCAN_TIMEOUT_PER_RELAY = 10000; // 10 seconds
  private readonly BROADCAST_TIMEOUT = 10000; // 10 seconds
  private readonly TOP_RELAYS_API = 'https://api.nostr.watch/v1/public';
  private readonly MAX_TOP_RELAYS = 50;
  
  private isScanning = false;
  private scanHistory: ScanResult[] = [];
  private shouldStopScan = false;

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
      // Handle Firefox compatibility: result might be undefined
      if (!result || typeof result !== 'object') {
        return [];
      }
      return result.inboxScannerEvents || [];
    } catch (error) {
      console.error('[InboxScanner] Error getting discovered events:', error);
      return [];
    }
  }

  /**
   * Stop the current scan
   */
  async stopScan(): Promise<void> {
    if (!this.isScanning) {
      console.log('[InboxScanner] No scan in progress');
      return;
    }
    
    console.log('[InboxScanner] Stopping scan...');
    this.shouldStopScan = true;
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
    this.shouldStopScan = false;
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
      
      if (this.shouldStopScan) {
        console.log('[InboxScanner] Scan stopped by user');
        throw new Error('Scan stopped by user');
      }
      
      console.log(`[InboxScanner] Found ${newEvents.length} new events`);

      // Update stats with discovered events immediately
      await this.incrementStats(newEvents.length, 0);

      // Broadcast all events to user's inbox relays in batch
      let broadcastCount = 0;
      if (newEvents.length > 0) {
        if (this.shouldStopScan) {
          console.log('[InboxScanner] Scan stopped by user before broadcast');
          throw new Error('Scan stopped by user');
        }
        
        broadcastCount = await this.broadcastEventsToInbox(newEvents);
        console.log(`[InboxScanner] Successfully broadcast ${broadcastCount}/${newEvents.length} events`);
        
        // Update broadcast count
        await this.incrementStats(0, broadcastCount);
      }

      // Store discovered events
      await this.storeDiscoveredEvents(newEvents);

      // Update statistics - only update lastScanTime if scan completed successfully
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
    } catch (error) {
      // If scan was stopped, don't update lastScanTime
      if (error instanceof Error && error.message === 'Scan stopped by user') {
        console.log('[InboxScanner] Scan stopped - lastScanTime not updated');
      }
      throw error;
    } finally {
      this.isScanning = false;
      this.shouldStopScan = false;
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
    
    // Get last scan time to only fetch new events
    const stats = await this.getStats();
    const sinceTimestamp = stats.lastScanTime 
      ? Math.floor(stats.lastScanTime / 1000) // Convert to Unix timestamp
      : undefined;

    if (sinceTimestamp) {
      console.log(`[InboxScanner] Fetching events since ${new Date(sinceTimestamp * 1000).toISOString()}`);
    } else {
      console.log('[InboxScanner] First scan - fetching all recent events');
    }

    // Process relays in batches to avoid overwhelming connections
    for (let i = 0; i < relays.length; i += this.MAX_CONCURRENT_RELAYS) {
      // Check if scan should stop
      if (this.shouldStopScan) {
        console.log('[InboxScanner] Stopping relay scan...');
        break;
      }
      
      const batch = relays.slice(i, i + this.MAX_CONCURRENT_RELAYS);
      const batchPromises = batch.map((relay) =>
        this.scanSingleRelay(relay, userPubkey, seenEventIds, sinceTimestamp)
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
   * Scan a single relay for events with proper timeout handling
   */
  private async scanSingleRelay(
    relayUrl: string,
    userPubkey: string,
    seenEventIds: Set<string>,
    sinceTimestamp?: number
  ): Promise<DiscoveredEvent[]> {
    return new Promise((resolve) => {
      const events: DiscoveredEvent[] = [];
      let ws: WebSocket;
      let isResolved = false;

      const resolveOnce = (result: DiscoveredEvent[]) => {
        if (!isResolved) {
          isResolved = true;
          resolve(result);
        }
      };

      // Check for stop before even starting
      if (this.shouldStopScan) {
        resolveOnce(events);
        return;
      }

      const timeout = setTimeout(() => {
        if (ws) {
          try {
            ws.close();
          } catch (err) {
            // Ignore close errors
          }
        }
        resolveOnce(events);
      }, this.SCAN_TIMEOUT_PER_RELAY);

      // Poll for stop signal periodically
      const stopCheckInterval = setInterval(() => {
        if (this.shouldStopScan) {
          clearInterval(stopCheckInterval);
          clearTimeout(timeout);
          if (ws) {
            try {
              ws.close();
            } catch (err) {
              // Ignore close errors
            }
          }
          resolveOnce(events);
        }
      }, 100); // Check every 100ms

      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        resolveOnce(events);
        return;
      }

      ws.onopen = () => {
        // Subscribe to events tagging the user
        const subscriptionId = `inbox-scan-${Date.now()}-${Math.random()}`;
        const filter: any = {
          '#p': [userPubkey],
          kinds: [1, 4, 5, 6, 7, 9735, 30023], // text notes, DMs, deletions, reposts, reactions, zaps, long-form
        };
        
        // Only fetch events created after the last scan
        if (sinceTimestamp) {
          filter.since = sinceTimestamp;
        }
        
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
            clearInterval(stopCheckInterval);
            ws.close();
            resolve(events);
          }
        } catch (error) {
          console.error(`[InboxScanner] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = (error) => {
        const errorMsg = error instanceof ErrorEvent ? error.message : 'Connection error';
        console.warn(`[InboxScanner] Error scanning ${relayUrl}: ${errorMsg}`);
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        resolveOnce(events);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        if (!isResolved) {
          resolveOnce(events);
        }
      };
    });
  }

  /**
   * Broadcast multiple events to user's inbox relays efficiently
   * Opens one connection per relay and sends all events through it
   */
  private async broadcastEventsToInbox(discoveredEvents: DiscoveredEvent[]): Promise<number> {
    try {
      const rm = await this.getRelayManager();
      const relayListManager = new RelayListManager(rm);
      const inboxRelays = await relayListManager.getReadRelays();

      if (inboxRelays.length === 0) {
        console.warn('[InboxScanner] No inbox relays found');
        return 0;
      }

      console.log(`[InboxScanner] Broadcasting ${discoveredEvents.length} events to ${inboxRelays.length} inbox relays`);

      // Broadcast to all relays in parallel, but each relay gets all events in one connection
      const broadcastPromises = inboxRelays.map((relayUrl) =>
        this.broadcastEventsToRelay(relayUrl, discoveredEvents)
      );

      const results = await Promise.allSettled(broadcastPromises);
      
      // Count total successful broadcasts across all relays
      let totalSuccessful = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const successCount = result.value;
          console.log(`[InboxScanner] ${inboxRelays[index]}: ${successCount}/${discoveredEvents.length} events accepted`);
          totalSuccessful += successCount;
        }
      });

      // Mark events as broadcast if at least one relay accepted them
      const eventSuccessMap = new Map<string, number>();
      
      // For simplicity, if we got any successful broadcasts, mark events as successful
      if (totalSuccessful > 0) {
        discoveredEvents.forEach(de => {
          de.broadcastStatus = 'success';
          de.broadcastCount = Math.min(totalSuccessful, inboxRelays.length);
        });
      }

      return discoveredEvents.filter(de => de.broadcastStatus === 'success').length;
    } catch (error) {
      console.error('[InboxScanner] Error broadcasting to inbox:', error);
      return 0;
    }
  }

  /**
   * Broadcast multiple events to a single relay using one persistent connection
   */
  private async broadcastEventsToRelay(
    relayUrl: string,
    discoveredEvents: DiscoveredEvent[]
  ): Promise<number> {
    return new Promise((resolve) => {
      let ws: WebSocket;
      let isResolved = false;
      let successCount = 0;
      const pendingEventIds = new Set(discoveredEvents.map(de => de.event.id));

      const resolveOnce = (count: number) => {
        if (!isResolved) {
          isResolved = true;
          resolve(count);
        }
      };

      // Check for stop before starting
      if (this.shouldStopScan) {
        resolveOnce(0);
        return;
      }

      const timeout = setTimeout(() => {
        if (ws) {
          try {
            ws.close();
          } catch (err) {
            // Ignore close errors
          }
        }
        resolveOnce(successCount);
      }, this.BROADCAST_TIMEOUT);

      // Poll for stop signal
      const stopCheckInterval = setInterval(() => {
        if (this.shouldStopScan) {
          clearInterval(stopCheckInterval);
          clearTimeout(timeout);
          if (ws) {
            try {
              ws.close();
            } catch (err) {
              // Ignore close errors
            }
          }
          resolveOnce(successCount);
        }
      }, 100);

      try {
        ws = new WebSocket(relayUrl);
      } catch (error) {
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        resolveOnce(0);
        return;
      }

      ws.onopen = () => {
        // Send all events at once
        discoveredEvents.forEach(discoveredEvent => {
          const eventMessage = JSON.stringify(['EVENT', discoveredEvent.event]);
          ws.send(eventMessage);
        });
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const [type, eventId, accepted] = data;

          if (type === 'OK' && pendingEventIds.has(eventId)) {
            if (accepted) {
              successCount++;
            }
            pendingEventIds.delete(eventId);
            
            // If all events have received responses, close connection
            if (pendingEventIds.size === 0) {
              clearTimeout(timeout);
              clearInterval(stopCheckInterval);
              ws.close();
              resolveOnce(successCount);
            }
          }
        } catch (error) {
          console.error(`[InboxScanner] Error parsing message from ${relayUrl}:`, error);
        }
      };

      ws.onerror = (error) => {
        const errorMsg = error instanceof ErrorEvent ? error.message : 'Connection error';
        console.warn(`[InboxScanner] Error broadcasting to ${relayUrl}: ${errorMsg}`);
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        resolveOnce(successCount);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        clearInterval(stopCheckInterval);
        if (!isResolved) {
          resolveOnce(successCount);
        }
      };
    });
  }

  /**
   * Get seen event IDs
   */
  private async getSeenEventIds(): Promise<Set<string>> {
    try {
      const result = await chrome.storage.local.get('inboxScannerSeenEvents');
      // Handle Firefox compatibility: result might be undefined
      if (!result || typeof result !== 'object') {
        return new Set();
      }
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
      // Firefox-compatible: wrap chrome.storage.local.get in a Promise
      const result = await new Promise<any>((resolve, reject) => {
        chrome.storage.local.get('inboxScannerStats', (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(result);
        });
      });
      
      // Handle both Chrome and Firefox API response formats
      if (!result || typeof result !== 'object') {
        return {
          lastScanTime: null,
          totalEventsDiscovered: 0,
          totalEventsBroadcast: 0,
        };
      }
      
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
