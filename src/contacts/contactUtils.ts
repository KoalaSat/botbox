import { nip19 } from 'nostr-tools';
import type { StoredContact } from '../services/db';

/**
 * Filter contacts based on a search term
 * @param contacts - Array of stored contacts
 * @param searchTerm - Search term to filter by
 * @returns Filtered array of contacts
 */
export function filterContacts(contacts: StoredContact[], searchTerm: string): StoredContact[] {
  if (!searchTerm) return contacts;
  
  const term = searchTerm.toLowerCase();
  
  return contacts.filter((contact) => {
    const name = (
      contact.profile?.display_name ||
      contact.profile?.name ||
      contact.petname ||
      ""
    ).toLowerCase();
    const about = (contact.profile?.about || "").toLowerCase();
    const npub = nip19.npubEncode(contact.pubkey).toLowerCase();
    
    return name.includes(term) || about.includes(term) || npub.includes(term);
  });
}

/**
 * Parse and validate a contact identifier (hex, npub, or NIP-05)
 * @param identifier - The identifier string to parse
 * @returns Object with the hex pubkey or error message
 */
export function parseContactIdentifier(identifier: string): { pubkey?: string; error?: string } {
  const trimmed = identifier.trim();
  
  if (!trimmed) {
    return { error: 'Please enter a pubkey, npub, or NIP-05 address' };
  }
  
  // Check if it's an npub
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'npub') {
        return { error: 'Invalid npub format' };
      }
      return { pubkey: decoded.data as string };
    } catch (err) {
      return { error: 'Invalid npub format. Please check and try again.' };
    }
  }
  
  // Check if it's a NIP-05 address
  if (trimmed.includes('@')) {
    return { pubkey: trimmed }; // Pass as-is, background will resolve it
  }
  
  // Check if it's a hex pubkey
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return { pubkey: trimmed.toLowerCase() };
  }
  
  return { 
    error: 'Invalid identifier. Please provide a valid pubkey (hex), npub, or NIP-05 address.' 
  };
}
