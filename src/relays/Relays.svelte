<script lang="ts">
  import { onMount } from 'svelte';
  import { sendToBackground } from '../shared/messaging';
  import { MessageType } from '../shared/messaging';
  import type { UserData } from '../services/db';
  import { nip19 } from 'nostr-tools';

  let isLoggedIn = false;
  let isLoading = false;
  let error = '';
  let userData: UserData | null = null;
  let relays: string[] = [];

  /**
   * Handle storage changes - refresh data when updated
   */
  async function handleStorageChange(changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) {
    if (areaName !== 'local') return;
    
    // Check if userData was updated
    if (changes.userData) {
      console.log('Storage changed, refreshing UI...');
      
      // Re-check login status and fetch fresh data
      await checkLoginStatus();
    }
  }

  onMount(() => {
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
        
        if (isLoggedIn && userData?.relays) {
          relays = userData.relays;
        }
      }
    } catch (err) {
      console.error('Error checking login status:', err);
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
        if (userData?.relays) {
          relays = userData.relays;
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

  function formatPubkey(pubkey: string): string {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.substring(0, 8)}...${npub.substring(npub.length - 8)}`;
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
</script>

<main>
  <div class="header">
    <h1>Relays</h1>
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
        You need to be logged in to view your relays.
      </p>
      <p class="info-small">
        Please open the extension popup and login with your NIP-07 extension.
      </p>
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
          🔄 Refresh
        </button>
      </div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">{relays.length}</div>
        <div class="stat-label">Total Relays</div>
      </div>
      {#if userData?.lastUpdated}
        <div class="stat">
          <div class="stat-value-small">{formatTimestamp(userData.lastUpdated)}</div>
          <div class="stat-label">Last Updated</div>
        </div>
      {/if}
    </div>

    <div class="relays-container">
      <div class="relays-header">
        <h2>All Relays</h2>
      </div>
      
      {#if relays.length === 0}
        <div class="empty">No relays found</div>
      {:else}
        <div class="relays-list">
          {#each relays as relay (relay)}
            <div class="relay-item">
              <div class="relay-icon">🔗</div>
              <div class="relay-url">{relay}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    text-align: center;
    padding: 20px;
    background: white;
    border-radius: 12px;
    margin-bottom: 20px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .header h1 {
    margin: 0;
    color: #667eea;
    font-size: 28px;
  }

  .error {
    background-color: #fee;
    color: #c33;
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .error button {
    background: none;
    border: none;
    color: #c33;
    font-size: 18px;
    cursor: pointer;
    padding: 0 8px;
  }

  .login-container {
    background: white;
    padding: 30px;
    border-radius: 12px;
    text-align: center;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .info {
    color: #555;
    margin: 12px 0;
    font-size: 16px;
  }

  .info-small {
    color: #888;
    font-size: 14px;
    margin: 8px 0;
  }

  .user-info {
    background: white;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .avatar, .avatar-placeholder {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
  }

  .profile-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name {
    font-weight: bold;
    font-size: 18px;
    color: #333;
  }

  .pubkey {
    font-size: 12px;
    color: #888;
    font-family: monospace;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .btn-small {
    padding: 8px 16px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s;
  }

  .btn-small:hover:not(:disabled) {
    background: #5568d3;
  }

  .btn-small:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }

  .stat {
    background: white;
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .stat-value {
    font-size: 32px;
    font-weight: bold;
    color: #667eea;
    margin-bottom: 8px;
  }

  .stat-value-small {
    font-size: 14px;
    color: #667eea;
    margin-bottom: 8px;
  }

  .stat-label {
    font-size: 14px;
    color: #888;
  }

  .relays-container {
    background: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .relays-header {
    margin-bottom: 20px;
  }

  .relays-header h2 {
    margin: 0;
    color: #333;
    font-size: 24px;
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: #888;
    font-size: 16px;
  }

  .relays-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .relay-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border: 2px solid #f0f0f0;
    border-radius: 12px;
    transition: all 0.2s;
  }

  .relay-item:hover {
    border-color: #667eea;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
  }

  .relay-icon {
    font-size: 24px;
    flex-shrink: 0;
  }

  .relay-url {
    font-size: 15px;
    color: #333;
    font-family: monospace;
    word-break: break-all;
  }

  @media (max-width: 768px) {
    main {
      padding: 10px;
    }
  }
</style>
