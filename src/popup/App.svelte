<script lang="ts">
  import { onMount } from 'svelte';
  import { sendToBackground } from '../shared/messaging';
  import { MessageType } from '../shared/messaging';
  import type { UserData, StoredContact } from '../services/db';
    import { nip19 } from 'nostr-tools';

  let isLoggedIn = false;
  let isLoading = false;
  let error = '';
  let userData: UserData | null = null;
  let contacts: StoredContact[] = [];
  let isFetchingContacts = false;

  /**
   * Handle storage changes - refresh data when updated
   */
  async function handleStorageChange(changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) {
    if (areaName !== 'local') return;
    
    // Check if userData or contactProfiles were updated
    if (changes.userData || changes.contactProfiles) {
      console.log('Storage changed, refreshing UI...');
      
      // Re-check login status and fetch fresh data
      await checkLoginStatus();
    }
  }

  onMount(() => {
    // Only check if already logged in, don't auto-connect
    checkLoginStatus();
    
    // Listen for storage changes to auto-refresh data
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    // Cleanup listener on unmount
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  });

  async function checkLoginStatus() {
    try {
      const response = await sendToBackground({
        type: MessageType.GET_LOGIN_STATUS,
      });

      if (response.success && response.data) {
        isLoggedIn = response.data.isLoggedIn;
        userData = response.data.userData;
        
        if (isLoggedIn) {
          await fetchContacts();
        }
      }
    } catch (err) {
      console.error('Error checking login status:', err);
    }
  }

  async function handleLogin() {
    isLoading = true;
    error = '';

    try {
      // Connect to NIP-07 via tab injection (background handles this)
      const connectResponse = await sendToBackground({
        type: MessageType.CONNECT_NIP07,
      });

      if (!connectResponse.success) {
        throw new Error(connectResponse.error || 'Failed to connect with NIP-07');
      }

      const { pubkey, relays } = connectResponse.data;

      // Send login request to background
      const loginResponse = await sendToBackground({
        type: MessageType.NIP07_LOGIN,
        payload: { pubkey, relays },
      });

      if (loginResponse.success) {
        userData = loginResponse.data;
        isLoggedIn = true;
        
        // Wait a bit for background to fetch data
        setTimeout(async () => {
          await fetchContacts();
        }, 2000);
      } else {
        throw new Error(loginResponse.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      error = err instanceof Error ? err.message : 'Unknown error occurred';
    } finally {
      isLoading = false;
    }
  }

  async function fetchContacts() {
    isFetchingContacts = true;
    try {
      const response = await sendToBackground({
        type: MessageType.FETCH_CONTACTS,
      });

      if (response.success) {
        contacts = response.data || [];
      }
    } catch (err) {
      console.error('Error fetching contacts:', err);
    } finally {
      isFetchingContacts = false;
    }
  }

  async function refreshUserData() {
    isLoading = true;
    error = '';
    try {
      const response = await sendToBackground({
        type: MessageType.FETCH_USER_DATA,
      });

      if (response.success) {
        userData = response.data;
        await fetchContacts();
      } else {
        throw new Error(response.error || 'Failed to refresh data');
      }
    } catch (err) {
      console.error('Error refreshing data:', err);
      error = err instanceof Error ? err.message : 'Failed to refresh data';
    } finally {
      isLoading = false;
    }
  }

  async function removeContact(pubkey: string) {
    if (!confirm('Are you sure you want to remove this contact? This will publish a new contact list to the relays.')) {
      return;
    }

    isLoading = true;
    error = '';
    try {
      const response = await sendToBackground({
        type: MessageType.REMOVE_CONTACT,
        payload: { pubkey },
      });

      if (response.success) {
        await fetchContacts();
      } else {
        throw new Error(response.error || 'Failed to remove contact');
      }
    } catch (err) {
      console.error('Error removing contact:', err);
      error = err instanceof Error ? err.message : 'Failed to remove contact';
    } finally {
      isLoading = false;
    }
  }

  async function handleLogout() {
    if (!confirm('Are you sure you want to logout? This will clear all local data.')) {
      return;
    }

    isLoading = true;
    try {
      const response = await sendToBackground({
        type: MessageType.LOGOUT,
      });

      if (response.success) {
        isLoggedIn = false;
        userData = null;
        contacts = [];
      }
    } catch (err) {
      console.error('Error logging out:', err);
    } finally {
      isLoading = false;
    }
  }

  function formatPubkey(pubkey: string): string {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.substring(0, 8)}...${npub.substring(npub.length - 8)}`;
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function openContactsPage() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('contacts.html')
    });
  }

  function openRelaysPage() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('relays.html')
    });
  }
</script>

<main>
  <div class="header">
    <h1>⚡ Nostr Contacts</h1>
  </div>

  {#if error}
    <div class="error">
      {error}
      <button on:click={() => error = ''}>✕</button>
    </div>
  {/if}

  {#if !isLoggedIn}
    <div class="login-container">
      <p class="info">
        Connect with your Nostr extension (NIP-07) to manage your contacts.
      </p>
      <p class="info-small">
        Required: Alby, nos2x, or another NIP-07 compatible extension
      </p>
      <button 
        class="btn-primary" 
        on:click={handleLogin} 
        disabled={isLoading}
      >
        {isLoading ? 'Connecting...' : 'Connect with NIP-07'}
      </button>
    </div>
  {:else}
    <div class="user-info">
      <div class="profile">
        {#if userData?.profile?.picture}
          <img src={userData.profile.picture} alt="Profile" class="avatar" />
        {:else}
          <div class="avatar-placeholder">👤</div>
        {/if}
        <div class="profile-details">
          <div class="name">
            {userData?.profile?.display_name || userData?.profile?.name || 'Anonymous'}
          </div>
          <div class="pubkey" title={userData?.pubkey}>
            {formatPubkey(userData?.pubkey || '')}
          </div>
        </div>
      </div>
      <div class="actions">
        <button 
          class="btn-small" 
          on:click={refreshUserData} 
          disabled={isLoading}
          title="Refresh data from relays"
        >
          🔄
        </button>
        <button 
          class="btn-small" 
          on:click={handleLogout} 
          disabled={isLoading}
          title="Logout"
        >
          🚪
        </button>
      </div>
    </div>

    <div class="stats">
      <div 
        class="stat stat-clickable" 
        on:click={openContactsPage}
        on:keydown={(e) => e.key === 'Enter' && openContactsPage()}
        role="button"
        tabindex="0"
        title="Click to view all contacts"
      >
        <div class="stat-value">{contacts.length}</div>
        <div class="stat-label">Contacts</div>
      </div>
      <div 
        class="stat stat-clickable" 
        on:click={openRelaysPage}
        on:keydown={(e) => e.key === 'Enter' && openRelaysPage()}
        role="button"
        tabindex="0"
        title="Click to view all relays"
      >
        <div class="stat-value">{userData?.relays.length || 0}</div>
        <div class="stat-label">Relays</div>
      </div>
      {#if userData?.lastUpdated}
        <div class="stat">
          <div class="stat-value-small">{formatTimestamp(userData.lastUpdated)}</div>
          <div class="stat-label">Last Updated</div>
        </div>
      {/if}
    </div>

    <div class="info-box">
      <p>Click on the <strong>Contacts</strong> or <strong>Relays</strong> cards above to view them in a new tab.</p>
    </div>
  {/if}
</main>
