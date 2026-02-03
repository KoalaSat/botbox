import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-svelte';
import type { RelayMetadata } from '../services/db';

export type RelayType = 'read' | 'write' | 'both';

/**
 * Get the display label for a relay type
 * @param type - Relay type
 * @returns Human-readable label
 */
export function getRelayTypeLabel(type: RelayType): string {
  switch (type) {
    case 'read':
      return 'Inbox (Read)';
    case 'write':
      return 'Outbox (Write)';
    case 'both':
      return 'Both (Read & Write)';
  }
}

/**
 * Get the icon component for a relay type
 * @param type - Relay type
 * @returns Lucide icon component
 */
export function getRelayTypeIcon(type: RelayType) {
  switch (type) {
    case 'read':
      return ArrowDownToLine;
    case 'write':
      return ArrowUpFromLine;
    case 'both':
      return RefreshCw;
  }
}

/**
 * Get the color for a relay type
 * @param type - Relay type
 * @returns Hex color string
 */
export function getRelayTypeColor(type: RelayType): string {
  switch (type) {
    case 'read':
      return '#28a745';
    case 'write':
      return '#667eea';
    case 'both':
      return '#17a2b8';
  }
}

/**
 * Filter relays based on a search term
 * @param relays - Array of relay metadata
 * @param searchTerm - Search term to filter by
 * @returns Filtered array of relays
 */
export function filterRelays(relays: RelayMetadata[], searchTerm: string): RelayMetadata[] {
  if (!searchTerm) return relays;
  
  const term = searchTerm.toLowerCase();
  return relays.filter((relay) => relay.url.toLowerCase().includes(term));
}

/**
 * Validate a relay URL format
 * @param url - Relay URL to validate
 * @returns Object with valid flag and optional error message
 */
export function validateRelayUrl(url: string): { valid: boolean; error?: string } {
  if (!url.trim()) {
    return { valid: false, error: 'Please enter a relay URL' };
  }

  if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
    return { valid: false, error: 'Relay URL must start with wss:// or ws://' };
  }

  return { valid: true };
}
