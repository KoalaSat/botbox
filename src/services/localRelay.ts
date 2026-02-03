/**
 * Local Write-Only Nostr Relay
 * A simple relay that runs in the background and accepts events from web clients
 * Based on NIP-01 relay protocol
 */

import { WebSocketServer, WebSocket } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface ClientMessage {
  type: 'EVENT' | 'REQ' | 'CLOSE';
  subscriptionId?: string;
  event?: NostrEvent;
  filters?: any[];
}

export class LocalRelayServer {
  private wss: WebSocketServer | null = null;
  private port: number;
  private events: Map<string, NostrEvent> = new Map();
  private maxEvents: number = 1000; // Keep last 1000 events in memory

  constructor(port: number = 7777) {
    this.port = port;
  }

  /**
   * Start the relay server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.log(`[LocalRelay] Write-only relay started on ws://localhost:${this.port}`);
          resolve();
        });

        this.wss.on('error', (error) => {
          console.error('[LocalRelay] Server error:', error);
          reject(error);
        });

        this.wss.on('connection', (ws: WebSocket, req: any) => {
          const origin = (req.headers.origin as string) || '';
          const isExtension = origin.startsWith('chrome-extension://') || 
                             origin.startsWith('moz-extension://') ||
                             origin.startsWith('extension://');
          
          // Store origin info on the WebSocket for later checks
          (ws as any).isExtension = isExtension;
          
          console.log(`[LocalRelay] New client connected (origin: ${origin}, isExtension: ${isExtension})`);
          
          // Send initial info message
          if (isExtension) {
            this.sendNotice(ws, `Connected to local relay on port ${this.port} (Extension mode: read+write)`);
          } else {
            this.sendNotice(ws, `Connected to local write-only relay on port ${this.port}`);
          }

          ws.on('message', (data: Buffer) => {
            this.handleMessage(ws, data);
          });

          ws.on('close', () => {
            console.log('[LocalRelay] Client disconnected');
          });

          ws.on('error', (error) => {
            console.error('[LocalRelay] WebSocket error:', error);
          });
        });

      } catch (error) {
        console.error('[LocalRelay] Failed to start server:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the relay server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('[LocalRelay] Server stopped');
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.wss !== null;
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get stored events
   */
  getEvents(): NostrEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Clear all stored events
   */
  clearEvents(): void {
    this.events.clear();
  }

  /**
   * Handle incoming messages from clients
   */
  private handleMessage(ws: WebSocket, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (!Array.isArray(message) || message.length === 0) {
        this.sendNotice(ws, 'Invalid message format');
        return;
      }

      const [type, ...args] = message;

      switch (type) {
        case 'EVENT':
          this.handleEvent(ws, args[0]);
          break;
        
        case 'REQ':
          // Only allow REQ from extension
          if ((ws as any).isExtension) {
            this.handleREQ(ws, args[0], args.slice(1));
          } else {
            this.sendNotice(ws, 'This is a write-only relay. REQ not supported for external clients.');
            this.sendEOSE(ws, args[0]); // Send EOSE immediately
          }
          break;
        
        case 'CLOSE':
          // Acknowledge subscription close
          console.log(`[LocalRelay] Subscription ${args[0]} closed`);
          break;
        
        default:
          this.sendNotice(ws, `Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('[LocalRelay] Error handling message:', error);
      this.sendNotice(ws, 'Error processing message');
    }
  }

  /**
   * Handle EVENT message
   */
  private handleEvent(ws: WebSocket, event: NostrEvent): void {
    try {
      // Validate event structure
      if (!event || typeof event !== 'object') {
        this.sendOK(ws, '', false, 'invalid: event must be an object');
        return;
      }

      const { id, pubkey, created_at, kind, tags, content, sig } = event;

      // Check required fields
      if (!id || !pubkey || !created_at || kind === undefined || !tags || content === undefined || !sig) {
        this.sendOK(ws, event.id || '', false, 'invalid: missing required fields');
        return;
      }

      // Verify event signature
      const isValid = verifyEvent(event);
      if (!isValid) {
        this.sendOK(ws, event.id, false, 'invalid: signature verification failed');
        return;
      }

      // Check if event already exists
      if (this.events.has(event.id)) {
        this.sendOK(ws, event.id, true, 'duplicate: event already stored');
        return;
      }

      // Store the event
      this.events.set(event.id, event);
      
      // Maintain max events limit (remove oldest)
      if (this.events.size > this.maxEvents) {
        const firstKey = this.events.keys().next().value;
        this.events.delete(firstKey);
      }

      console.log(`[LocalRelay] Stored event ${event.id.substring(0, 8)}... (kind: ${event.kind})`);
      
      // Send success response
      this.sendOK(ws, event.id, true, '');

    } catch (error) {
      console.error('[LocalRelay] Error handling event:', error);
      this.sendOK(ws, event?.id || '', false, 'error: internal server error');
    }
  }

  /**
   * Send OK message (NIP-20)
   */
  private sendOK(ws: WebSocket, eventId: string, accepted: boolean, message: string): void {
    const response = JSON.stringify(['OK', eventId, accepted, message]);
    ws.send(response);
  }

  /**
   * Send NOTICE message
   */
  private sendNotice(ws: WebSocket, message: string): void {
    const response = JSON.stringify(['NOTICE', message]);
    ws.send(response);
  }

  /**
   * Send EOSE (End of Stored Events) message
   */
  private sendEOSE(ws: WebSocket, subscriptionId: string): void {
    const response = JSON.stringify(['EOSE', subscriptionId]);
    ws.send(response);
  }

  /**
   * Handle REQ message (only for extension)
   */
  private handleREQ(ws: WebSocket, subscriptionId: string, filters: any[]): void {
    console.log(`[LocalRelay] Processing REQ from extension:`, subscriptionId, filters);
    
    // Get all stored events
    const allEvents = Array.from(this.events.values());
    
    // Apply filters if provided
    let matchedEvents = allEvents;
    
    if (filters && filters.length > 0) {
      matchedEvents = allEvents.filter(event => 
        filters.some(filter => this.matchesFilter(event, filter))
      );
    }
    
    // Sort by created_at descending (newest first)
    matchedEvents.sort((a, b) => b.created_at - a.created_at);
    
    console.log(`[LocalRelay] Sending ${matchedEvents.length} events for subscription ${subscriptionId}`);
    
    // Send matched events
    matchedEvents.forEach(event => {
      const message = JSON.stringify(['EVENT', subscriptionId, event]);
      ws.send(message);
    });
    
    // Send EOSE
    this.sendEOSE(ws, subscriptionId);
  }

  /**
   * Check if an event matches a filter
   */
  private matchesFilter(event: NostrEvent, filter: any): boolean {
    // Check ids
    if (filter.ids && filter.ids.length > 0) {
      if (!filter.ids.some((id: string) => event.id.startsWith(id))) {
        return false;
      }
    }
    
    // Check authors
    if (filter.authors && filter.authors.length > 0) {
      if (!filter.authors.some((author: string) => event.pubkey.startsWith(author))) {
        return false;
      }
    }
    
    // Check kinds
    if (filter.kinds && filter.kinds.length > 0) {
      if (!filter.kinds.includes(event.kind)) {
        return false;
      }
    }
    
    // Check since
    if (filter.since && event.created_at < filter.since) {
      return false;
    }
    
    // Check until
    if (filter.until && event.created_at > filter.until) {
      return false;
    }
    
    // Check limit is handled after filtering
    
    return true;
  }

  /**
   * Broadcast event to all connected clients (if needed in the future)
   */
  private broadcast(event: NostrEvent): void {
    if (!this.wss) return;

    const message = JSON.stringify(['EVENT', 'broadcast', event]);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// Singleton instance
let relayInstance: LocalRelayServer | null = null;

/**
 * Get or create relay instance
 */
export function getLocalRelay(port: number = 7777): LocalRelayServer {
  if (!relayInstance) {
    relayInstance = new LocalRelayServer(port);
  }
  return relayInstance;
}

/**
 * Start the local relay
 */
export async function startLocalRelay(port: number = 7777): Promise<LocalRelayServer> {
  const relay = getLocalRelay(port);
  if (!relay.isRunning()) {
    await relay.start();
  }
  return relay;
}

/**
 * Stop the local relay
 */
export async function stopLocalRelay(): Promise<void> {
  if (relayInstance) {
    await relayInstance.stop();
    relayInstance = null;
  }
}
