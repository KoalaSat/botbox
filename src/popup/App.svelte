<script lang="ts">
  import { onMount } from 'svelte';
  import { sendToBackground } from '../shared/messaging';
  import { MessageType } from '../shared/messaging';
  import type { UserData, StoredContact } from '../services/db';
  import { Database } from '../services/db';
  import Contacts from '../contacts/Contacts.svelte';
  import Relays from '../relays/Relays.svelte';
  import LocalRelayEvents from '../localRelayEvents/LocalRelayEvents.svelte';
  import ConsistencyRelaySettings from '../appRelaySettings/AppRelaySettings.svelte';
  import { Zap, User, RefreshCw, LogOut, X, ExternalLink, ArrowLeft } from 'lucide-svelte';
  import { formatPubkey } from '../shared/formatters';

  let isLoggedIn = false;
  let isLoading = false;
  let error = '';
  let userData: UserData | null = null;
  let contacts: StoredContact[] = [];
  let isFetchingContacts = false;
  let currentView: 'home' | 'contacts' | 'relays' | 'localRelayEvents' | 'consistencyRelaySettings' = 'home';
  let contactsComponent: Contacts;
  let relaysComponent: Relays;
  let localRelayEventsComponent: LocalRelayEvents;
  let consistencyRelayUrl: string | null = null;

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
    // Check if already logged in and refresh data
    checkLoginStatus().then(async () => {
      if (isLoggedIn) {
        await refreshData();
      }
    });
    
    // Load consistency relay URL
    loadConsistencyRelayUrl();
    
    // Listen for storage changes to auto-refresh data
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    // Cleanup listener on unmount
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  });

  async function loadConsistencyRelayUrl() {
    consistencyRelayUrl = await Database.getConsistencyRelayUrl();
  }

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

  async function refreshData() {
    isLoading = true;
    error = '';
    try {
      const response = await sendToBackground({
        type: MessageType.REFRESH_DATA,
      });

      if (response.success) {
        userData = response.data;
        await fetchContacts();
        
        // Also refresh the current view's specific data
        if (currentView === 'contacts' && contactsComponent) {
          await contactsComponent.fetchContacts();
        } else if (currentView === 'relays' && relaysComponent) {
          await relaysComponent.fetchRelays();
        }
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
        currentView = 'home';
      }
    } catch (err) {
      console.error('Error logging out:', err);
    } finally {
      isLoading = false;
    }
  }

  function showContacts() {
    currentView = 'contacts';
  }

  function showRelays() {
    currentView = 'relays';
  }

  function showLocalRelayEvents() {
    currentView = 'localRelayEvents';
  }

  function showConsistencyRelaySettings() {
    currentView = 'consistencyRelaySettings';
  }

  async function handleConsistencyRelayBoxClick() {
    if (consistencyRelayUrl) {
      // If configured, show events
      showLocalRelayEvents();
    } else {
      // If not configured, show settings
      showConsistencyRelaySettings();
    }
  }

  function showHome() {
    currentView = 'home';
    // Reload consistency relay URL when returning home
    loadConsistencyRelayUrl();
  }
</script>

<main>
  <div class="header">
    <h1><Zap size={24} /> Nostr Contacts</h1>
  </div>

  {#if error}
    <div class="error">
      {error}
      <button on:click={() => error = ''}><X size={18} /></button>
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
          <div class="avatar-placeholder"><User size={24} /></div>
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
          on:click={refreshData} 
          disabled={isLoading}
          title="Refresh data from relays"
        >
          {#if isLoading}
            <RefreshCw size={16} class="spin" />
          {:else}
            <RefreshCw size={16} />
          {/if}
        </button>
        <button 
          class="btn-small" 
          on:click={handleLogout} 
          disabled={isLoading}
          title="Logout"
        >
          <LogOut size={16} />
        </button>
      </div>
    </div>

    {#if currentView === 'home'}
      <div class="stats">
        <div 
          class="stat stat-clickable" 
          on:click={showContacts}
          on:keydown={(e) => e.key === 'Enter' && showContacts()}
          role="button"
          tabindex="0"
          title="Click to view all contacts"
        >
          <div class="stat-value">{contacts.length}</div>
          <div class="stat-label">Contacts</div>
        </div>
        <div 
          class="stat stat-clickable" 
          on:click={showRelays}
          on:keydown={(e) => e.key === 'Enter' && showRelays()}
          role="button"
          tabindex="0"
          title="Click to view all relays"
        >
          <div class="stat-value">{userData?.relays.length || 0}</div>
          <div class="stat-label">Relays</div>
        </div>
        {#if userData?.lastUpdated}
          <div class="stat">
            <div class="stat-value-small">{new Date(userData.lastUpdated).toLocaleString()}</div>
            <div class="stat-label">Last Updated</div>
          </div>
        {/if}
      </div>

      <div 
        class="info-box info-box-clickable"
        on:click={handleConsistencyRelayBoxClick}
        on:keydown={(e) => e.key === 'Enter' && handleConsistencyRelayBoxClick()}
        role="button"
        tabindex="0"
        title={consistencyRelayUrl ? 'Click to view relay events' : 'Click to configure consistency relay'}
      >
        <div class="relay-info">
          <div class="relay-header">
            <Zap size={16} />
            <strong>Consistency Relay</strong>
          </div>
          {#if consistencyRelayUrl}
            <div class="relay-details">
              <div class="relay-url">
                <code>{consistencyRelayUrl}</code>
              </div>
            </div>
            <p class="relay-description">
              Click to view your events from this relay.
            </p>
          {:else}
            <p class="relay-description">
              Not configured. Click to set up your consistency relay.
            </p>
          {/if}
        </div>
      </div>
    {:else if currentView === 'contacts'}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Contacts</h2>
        <button class="btn-back" on:click={() => window.open('https://following.space', '_blank')}>
          Follow packs 
          <ExternalLink size={16} />
        </button>
      </div>
      <Contacts bind:this={contactsComponent} />
    {:else if currentView === 'relays'}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Relays</h2>
        <div></div>
      </div>
      <Relays bind:this={relaysComponent} />
    {:else if currentView === 'localRelayEvents'}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Consistency Relay</h2>
        <button class="btn-back" on:click={showConsistencyRelaySettings}>
          Settings
        </button>
      </div>
      <LocalRelayEvents bind:this={localRelayEventsComponent} />
    {:else if currentView === 'consistencyRelaySettings'}
      <div class="nav-header">
        <button class="btn-back" on:click={showLocalRelayEvents}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Consistency Settings</h2>
        <div></div>
      </div>
      <ConsistencyRelaySettings />
    {/if}
  {/if}
</main>
