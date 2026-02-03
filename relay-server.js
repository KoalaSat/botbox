#!/usr/bin/env node
/**
 * Standalone Local Nostr Relay Server
 * A simple write-only relay that accepts events from web clients
 * Run with: node relay-server.js [port]
 */

import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';

const DEFAULT_PORT = 7777;
const MAX_EVENTS = 1000;

class LocalRelayServer {
  constructor(port = DEFAULT_PORT) {
    this.port = port;
    this.events = new Map();
    this.maxEvents = MAX_EVENTS;
    this.wss = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
          console.log(`✅ Local write-only Nostr relay started`);
          console.log(`📡 Listening on: ws://localhost:${this.port}`);
          console.log(`📝 Max events in memory: ${this.maxEvents}`);
          console.log(`\nPress Ctrl+C to stop\n`);
          resolve();
        });

        this.wss.on('error', (error) => {
          console.error('❌ Server error:', error.message);
          if (error.code === 'EADDRINUSE') {
            console.error(`\n⚠️  Port ${this.port} is already in use.`);
            console.error(`Try a different port: node relay-server.js <port>\n`);
          }
          reject(error);
        });

        this.wss.on('connection', (ws, req) => {
          const clientIp = req.socket.remoteAddress;
          console.log(`[${new Date().toISOString()}] ✓ Client connected from ${clientIp}`);
          
          this.sendNotice(ws, `Connected to local write-only relay on port ${this.port}`);

          ws.on('message', (data) => {
            this.handleMessage(ws, data);
          });

          ws.on('close', () => {
            console.log(`[${new Date().toISOString()}] ✗ Client disconnected`);
          });

          ws.on('error', (error) => {
            console.error(`[${new Date().toISOString()}] ⚠️  WebSocket error:`, error.message);
          });
        });

      } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        reject(error);
      }
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('\n👋 Server stopped');
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  handleMessage(ws, data) {
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
          // Write-only relay: we don't support queries
          this.sendNotice(ws, 'This is a write-only relay. REQ not supported.');
          this.sendEOSE(ws, args[0]);
          break;
        
        case 'CLOSE':
          // Acknowledge subscription close
          console.log(`[${new Date().toISOString()}] 🔒 Subscription ${args[0]} closed`);
          break;
        
        default:
          this.sendNotice(ws, `Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ⚠️  Error handling message:`, error.message);
      this.sendNotice(ws, 'Error processing message');
    }
  }

  handleEvent(ws, event) {
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
        console.log(`[${new Date().toISOString()}] ❌ Invalid signature for event ${id.substring(0, 8)}...`);
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

      console.log(`[${new Date().toISOString()}] ✓ Stored event ${event.id.substring(0, 8)}... (kind: ${event.kind}) - Total: ${this.events.size}/${this.maxEvents}`);
      
      // Send success response
      this.sendOK(ws, event.id, true, '');

    } catch (error) {
      console.error(`[${new Date().toISOString()}] ⚠️  Error handling event:`, error.message);
      this.sendOK(ws, event?.id || '', false, 'error: internal server error');
    }
  }

  sendOK(ws, eventId, accepted, message) {
    const response = JSON.stringify(['OK', eventId, accepted, message]);
    ws.send(response);
  }

  sendNotice(ws, message) {
    const response = JSON.stringify(['NOTICE', message]);
    ws.send(response);
  }

  sendEOSE(ws, subscriptionId) {
    const response = JSON.stringify(['EOSE', subscriptionId]);
    ws.send(response);
  }

  getStats() {
    return {
      port: this.port,
      eventsStored: this.events.size,
      maxEvents: this.maxEvents,
      uptime: process.uptime(),
    };
  }
}

// Main execution
const port = parseInt(process.argv[2]) || DEFAULT_PORT;
const relay = new LocalRelayServer(port);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Shutting down gracefully...');
  const stats = relay.getStats();
  console.log(`📊 Final stats: ${stats.eventsStored} events stored`);
  await relay.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await relay.stop();
  process.exit(0);
});

// Start the server
relay.start().catch((error) => {
  console.error('❌ Failed to start relay server:', error.message);
  process.exit(1);
});
