/**
 * NIP-11: Relay Information Document
 * Fetches relay metadata from relays via HTTP
 */

import type { RelayInfo } from './db';

/**
 * Convert WebSocket URL to HTTP URL for NIP-11 queries
 */
function wsToHttp(wsUrl: string): string {
  return wsUrl.replace(/^wss?:\/\//, (match) => {
    return match === 'wss://' ? 'https://' : 'http://';
  });
}

/**
 * Fetch relay information document (NIP-11)
 * 
 * @param relayUrl - WebSocket URL of the relay (wss:// or ws://)
 * @param timeoutMs - Request timeout in milliseconds
 * @returns RelayInfo object or null if fetch fails
 */
export async function fetchRelayInfo(relayUrl: string, timeoutMs: number = 5000): Promise<RelayInfo | null> {
  try {
    const httpUrl = wsToHttp(relayUrl);
    
    console.log(`[NIP-11] Fetching relay info from ${httpUrl}`);
    
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(httpUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/nostr+json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[NIP-11] HTTP ${response.status} for ${httpUrl}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/nostr+json')) {
      console.warn(`[NIP-11] Invalid content-type for ${httpUrl}: ${contentType}`);
      // Still try to parse as JSON in case the relay doesn't set the correct header
    }
    
    const data = await response.json();
    
    // Validate that we got a valid NIP-11 document
    if (typeof data !== 'object' || data === null) {
      console.warn(`[NIP-11] Invalid response format from ${httpUrl}`);
      return null;
    }
    
    console.log(`[NIP-11] Successfully fetched info for ${relayUrl}`, data);
    
    return {
      name: data.name,
      description: data.description,
      pubkey: data.pubkey,
      contact: data.contact,
      supported_nips: data.supported_nips,
      software: data.software,
      version: data.version,
      icon: data.icon,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn(`[NIP-11] Timeout fetching info for ${relayUrl}`);
    } else {
      console.warn(`[NIP-11] Error fetching info for ${relayUrl}:`, error);
    }
    return null;
  }
}

/**
 * Fetch relay information for multiple relays in parallel
 * 
 * @param relayUrls - Array of WebSocket URLs
 * @param timeoutMs - Request timeout in milliseconds per relay
 * @returns Map of relay URL to RelayInfo
 */
export async function fetchRelayInfoBatch(
  relayUrls: string[],
  timeoutMs: number = 5000
): Promise<Map<string, RelayInfo>> {
  const results = new Map<string, RelayInfo>();
  
  console.log(`[NIP-11] Fetching info for ${relayUrls.length} relays`);
  
  // Fetch all relay info in parallel
  const promises = relayUrls.map(async (url) => {
    const info = await fetchRelayInfo(url, timeoutMs);
    if (info) {
      results.set(url, info);
    }
  });
  
  await Promise.allSettled(promises);
  
  console.log(`[NIP-11] Successfully fetched info for ${results.size}/${relayUrls.length} relays`);
  
  return results;
}
