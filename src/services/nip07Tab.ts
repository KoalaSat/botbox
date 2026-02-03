/**
 * NIP-07 Tab Injection Service
 * Accesses window.nostr by injecting code into the active tab
 * This is necessary because browser extension popups don't have access to window.nostr
 */

import type { EventTemplate, VerifiedEvent } from 'nostr-tools';

export class Nip07TabService {
  private static helperTabId: number | null = null;

  /**
   * Find an existing helper tab or any suitable tab with window.nostr
   */
  private static async findSuitableTab(): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({});
    
    // First, check if our helper tab still exists
    if (this.helperTabId) {
      const helperTab = tabs.find(t => t.id === this.helperTabId);
      if (helperTab && helperTab.url?.includes('nip07-helper.html')) {
        return helperTab;
      }
      // Helper tab was closed
      this.helperTabId = null;
    }

    // Look for any existing helper tab
    const helperTab = tabs.find(t => t.url?.includes('nip07-helper.html'));
    if (helperTab?.id) {
      this.helperTabId = helperTab.id;
      return helperTab;
    }

    // Look for any regular webpage (not extension or browser pages)
    const regularTab = tabs.find(t => 
      t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))
    );
    
    return regularTab || null;
  }

  /**
   * Create a helper tab with access to window.nostr
   */
  private static async createHelperTab(): Promise<chrome.tabs.Tab> {
    const helperUrl = chrome.runtime.getURL('nip07-helper.html');
    const tab = await chrome.tabs.create({
      url: helperUrl,
      active: false, // Don't switch to it
    });

    if (!tab.id) {
      throw new Error('Failed to create helper tab');
    }

    this.helperTabId = tab.id;

    // Wait for tab to load
    await new Promise<void>((resolve) => {
      const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 5 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 5000);
    });

    return tab;
  }

  /**
   * Get a tab suitable for NIP-07 operations
   * Will try to find existing tab, or create a helper tab if needed
   */
  private static async getOrCreateSuitableTab(autoCreate: boolean = true): Promise<chrome.tabs.Tab> {
    // Try to find existing suitable tab
    let tab = await this.findSuitableTab();
    
    if (tab?.id) {
      return tab;
    }

    // No suitable tab found
    if (!autoCreate) {
      throw new Error(
        'No webpage available for NIP-07 signing. Please open a regular webpage (http:// or https://) ' +
        'or allow the extension to create a helper tab.'
      );
    }

    // Create helper tab
    console.log('No suitable tab found, creating helper tab...');
    tab = await this.createHelperTab();
    
    return tab;
  }

  /**
   * Get the active tab (deprecated - use getOrCreateSuitableTab instead)
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
   * Execute code in a suitable tab
   */
  private static async executeInTab<T>(func: () => T, autoCreateHelper: boolean = true): Promise<T> {
    const tab = await this.getOrCreateSuitableTab(autoCreateHelper);
    
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
   * Check if NIP-07 provider is available
   */
  static async isAvailable(autoCreateHelper: boolean = false): Promise<boolean> {
    try {
      return await this.executeInTab(() => {
        return typeof window.nostr !== 'undefined';
      }, autoCreateHelper);
    } catch (error) {
      console.error('Error checking NIP-07 availability:', error);
      return false;
    }
  }

  /**
   * Ensure a helper tab exists and is ready
   */
  static async ensureHelperTab(): Promise<void> {
    await this.getOrCreateSuitableTab(true);
  }

  /**
   * Close the helper tab if it exists
   */
  static async closeHelperTab(): Promise<void> {
    if (this.helperTabId) {
      try {
        await chrome.tabs.remove(this.helperTabId);
      } catch (error) {
        console.warn('Failed to close helper tab:', error);
      }
      this.helperTabId = null;
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
    const tab = await this.getOrCreateSuitableTab(true);
    
    // Use chrome.scripting.executeScript with args to pass the event
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: async (eventToSign: any) => {
        if (!window.nostr) {
          return { error: 'NIP-07 provider not found' };
        }
        
        try {
          const signed = await window.nostr.signEvent(eventToSign);
          return signed;
        } catch (err: any) {
          return { error: err.message || 'Failed to sign event' };
        }
      },
      args: [event],
      world: 'MAIN',
    });

    if (!results || results.length === 0) {
      throw new Error('Failed to execute script in tab');
    }

    const result = results[0].result;
    
    if (!result) {
      throw new Error('No result from signing operation');
    }
    
    if (typeof result === 'object' && 'error' in result) {
      throw new Error((result as any).error);
    }

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
   * Wait for NIP-07 provider to be available
   */
  static async waitForProvider(timeoutMs: number = 5000, autoCreateHelper: boolean = true): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const available = await this.isAvailable(autoCreateHelper);
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

  /**
   * Get information about the current NIP-07 setup
   */
  static async getStatus(): Promise<{
    hasHelperTab: boolean;
    hasSuitableTab: boolean;
    helperTabId: number | null;
  }> {
    const suitableTab = await this.findSuitableTab();
    const isHelper = suitableTab?.url?.includes('nip07-helper.html') || false;

    return {
      hasHelperTab: isHelper,
      hasSuitableTab: suitableTab !== null,
      helperTabId: this.helperTabId,
    };
  }
}

// Make the event parameter available to the injected function
declare global {
  const eventToSign: any;
}
