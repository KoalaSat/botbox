import { nip19 } from 'nostr-tools';

/**
 * Format a pubkey to a shortened npub display format
 * @param pubkey - Hex pubkey string
 * @returns Formatted npub string (e.g., "npub1abc...xyz")
 */
export function formatPubkey(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.substring(0, 8)}...${npub.substring(npub.length - 8)}`;
}

/**
 * Decode an npub to hex pubkey
 * @param npub - Npub string starting with "npub1"
 * @returns Hex pubkey string
 * @throws Error if the npub format is invalid
 */
export function decodeNpub(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
      throw new Error('Invalid npub format');
    }
    return decoded.data as string;
  } catch (err) {
    throw new Error('Invalid npub format. Please check and try again.');
  }
}
