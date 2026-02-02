/**
 * Profile Manager for fetching and caching Nostr profiles (kind 0)
 */

import type { Event as NostrEvent } from 'nostr-tools';
import { RelayManager } from './relayManager';
import { Database, type NostrProfile } from './db';

export class ProfileManager {
  private relayManager: RelayManager;

  constructor(relayManager: RelayManager) {
    this.relayManager = relayManager;
  }

  /**
   * Parse profile metadata from event content
   */
  private parseProfile(content: string): NostrProfile | null {
    try {
      return JSON.parse(content) as NostrProfile;
    } catch (error) {
      console.error('Failed to parse profile:', error);
      return null;
    }
  }

  /**
   * Fetch profile for a single pubkey
   */
  async fetchProfile(pubkey: string): Promise<NostrProfile | null> {
    const events = await this.relayManager.fetchEvents([
      {
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      }
    ]);

    if (events.length === 0) {
      return null;
    }

    // Get the most recent profile event
    const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
    const profile = this.parseProfile(latestEvent.content);
    
    if (profile) {
      await Database.setContactProfile(pubkey, profile);
    }

    return profile;
  }

  /**
   * Fetch profiles for multiple pubkeys
   */
  async fetchProfiles(pubkeys: string[]): Promise<Record<string, NostrProfile>> {
    if (pubkeys.length === 0) {
      return {};
    }

    const events = await this.relayManager.fetchEvents([
      {
        kinds: [0],
        authors: pubkeys,
      }
    ], 8000); // Longer timeout for multiple profiles

    // Group events by author and keep only the latest
    const latestByAuthor = new Map<string, NostrEvent>();
    
    for (const event of events) {
      const existing = latestByAuthor.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        latestByAuthor.set(event.pubkey, event);
      }
    }

    // Parse profiles
    const profiles: Record<string, NostrProfile> = {};
    
    for (const [pubkey, event] of latestByAuthor) {
      const profile = this.parseProfile(event.content);
      if (profile) {
        profiles[pubkey] = profile;
      }
    }

    // Cache profiles
    await Database.setContactProfiles(profiles);

    return profiles;
  }

  /**
   * Fetch user's own profile
   */
  async fetchUserProfile(pubkey: string): Promise<NostrProfile | null> {
    const profile = await this.fetchProfile(pubkey);
    if (profile) {
      await Database.updateUserProfile(profile);
    }
    return profile;
  }

  /**
   * Subscribe to profile updates
   */
  subscribeToProfiles(
    pubkeys: string[],
    onProfile: (pubkey: string, profile: NostrProfile) => void
  ): string {
    return this.relayManager.subscribe(
      [
        {
          kinds: [0],
          authors: pubkeys,
        }
      ],
      (event: NostrEvent) => {
        const profile = this.parseProfile(event.content);
        if (profile) {
          Database.setContactProfile(event.pubkey, profile);
          onProfile(event.pubkey, profile);
        }
      }
    );
  }

  /**
   * Unsubscribe from profile updates
   */
  unsubscribe(subId: string): void {
    this.relayManager.unsubscribe(subId);
  }
}
