/**
 * NIP-07: window.nostr capability for web browsers
 * Extends nostr-tools WindowNostr types with getRelays() method supported by some extensions
 * https://github.com/nostr-protocol/nips/blob/master/07.md
 */

import type { WindowNostr } from 'nostr-tools/nip07';

declare global {
  interface Window {
    nostr?: WindowNostr & {
      getRelays?(): Promise<Record<string, { read: boolean; write: boolean }>>;
    };
  }
}

export {};
