/**
 * NIP-07 Tab Injection Service
 * Accesses window.nostr by injecting code into the active tab
 * This is necessary because browser extension popups don't have access to window.nostr
 */

import type { EventTemplate, VerifiedEvent } from 'nostr-tools';

export class Nip07TabService {
  /**
   * Get the active tab
   */
  private static async getActiveTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    
    if (!tab?.id) {
      throw new Error('No active tab found. Please make sure you have a web page open.');
    }

    // Check if it's a valid URL
    if (tab.url && (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('brave://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('moz-extension://')
    )) {
      throw new Error('Please navigate to a regular webpage (http:// or https://) to connect with NIP-07.');
    }

    return tab;
  }

  /**
   * Execute code in the active tab
   */
  private static async executeInTab<T>(func: () => T): Promise<T> {
    const tab = await this.getActiveTab();
    
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: func,
      world: 'MAIN', // Execute in the main world where window.nostr exists
    });

    if (!results || results.length === 0) {
      throw new Error('Failed to execute script in tab');
    }

    const result = results[0].result;
    if (result && typeof result === 'object' && 'error' in result) {
      throw new Error((result as any).error);
    }

    return result as T;
  }

  /**
   * Check if NIP-07 provider is available in the active tab
   */
  static async isAvailable(): Promise<boolean> {
    try {
      return await this.executeInTab(() => {
        return typeof window.nostr !== 'undefined';
      });
    } catch (error) {
      console.error('Error checking NIP-07 availability:', error);
      return false;
    }
  }

  /**
   * Get user's public key from NIP-07 provider
   */
  static async getPublicKey(): Promise<string> {
    const result = await this.executeInTab(async () => {
      if (!window.nostr) {
        throw new Error('NIP-07 provider not found. Please install a Nostr extension like Alby or nos2x.');
      }
      
      const pubkey = await window.nostr.getPublicKey();
      return pubkey;
    });
    
    return result;
  }

  /**
   * Sign an event using NIP-07 provider
   * Returns the signed event (we cast to VerifiedEvent since NIP-07 providers return signed events)
   */
  static async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    const eventToSign = event;
    
    const result = await this.executeInTab(async () => {
      if (!window.nostr) {
        throw new Error('NIP-07 provider not found');
      }
      
      const signed = await window.nostr.signEvent(eventToSign as any);
      return signed;
    });
    
    // NIP-07 providers return signed events, so we can safely cast
    return result as VerifiedEvent;
  }

  /**
   * Get user's relays from NIP-07 provider (if supported)
   */
  static async getRelays(): Promise<Record<string, { read: boolean; write: boolean }> | null> {
    try {
      return await this.executeInTab(async () => {
        if (!window.nostr || !window.nostr.getRelays) {
          return null;
        }
        
        try {
          const relays = await window.nostr.getRelays();
          return relays;
        } catch (err) {
          console.warn('Failed to get relays:', err);
          return null;
        }
      });
    } catch (error) {
      console.warn('Error getting relays from NIP-07:', error);
      return null;
    }
  }

  /**
   * Wait for NIP-07 provider to be available in the active tab
   */
  static async waitForProvider(timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const available = await this.isAvailable();
        if (available) {
          return true;
        }
      } catch (error) {
        // Tab might not be ready yet, continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return false;
  }
}

// Make the event parameter available to the injected function
declare global {
  const eventToSign: any;
}
