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
  let searchTerm = '';
  let filteredContacts: StoredContact[] = [];

  function updateFilteredContacts() {
    filteredContacts = contacts.filter(contact => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const name = (contact.profile?.display_name || contact.profile?.name || contact.petname || '').toLowerCase();
      const about = (contact.profile?.about || '').toLowerCase();
      const npub = nip19.npubEncode(contact.pubkey).toLowerCase();
      return name.includes(term) || about.includes(term) || npub.includes(term);
    });
  }

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

  async function fetchContacts() {
    isFetchingContacts = true;
    try {
      const response = await sendToBackground({
        type: MessageType.FETCH_CONTACTS,
      });

      if (response.success) {
        contacts = response.data || [];
        updateFilteredContacts();
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

  function formatPubkey(pubkey: string): string {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.substring(0, 8)}...${npub.substring(npub.length - 8)}`;
  }

  function formatFullPubkey(pubkey: string): string {
    return nip19.npubEncode(pubkey);
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
</script>

<main>
  <div class="header">
    <h1>Contacts</h1>
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
        You need to be logged in to view your contacts.
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
        <div class="stat-value">{contacts.length}</div>
        <div class="stat-label">Total Contacts</div>
      </div>
      <a 
        href="https://following.space/" 
        target="_blank" 
        rel="noopener noreferrer" 
        class="stat stat-link"
        title="View on following.space"
      >
        <div class="stat-value">
          Follow Lists
          <span class="external-icon">↗</span>
        </div>
        <div class="stat-label">Discover new follows</div>
      </a>
      {#if userData?.lastUpdated}
        <div class="stat">
          <div class="stat-value">{formatTimestamp(userData.lastUpdated)}</div>
          <div class="stat-label">Last Updated</div>
        </div>
      {/if}
    </div>

    <div class="contacts-container">
      <div class="contacts-header">
        <h2>All Contacts</h2>
        <input 
          type="text" 
          class="search-input" 
          placeholder="Search contacts..." 
          bind:value={searchTerm}
          on:input={updateFilteredContacts}
        />
      </div>
      
      {#if isFetchingContacts}
        <div class="loading">Loading contacts...</div>
      {:else if contacts.length === 0}
        <div class="empty">No contacts found</div>
      {:else if filteredContacts.length === 0}
        <div class="empty">No contacts match your search</div>
      {:else}
        <div class="contacts-list">
          {#each filteredContacts as contact (contact.pubkey)}
            <div class="contact-item">
              <div class="contact-info">
                {#if contact.profile?.picture}
                  <img src={contact.profile.picture} alt="Profile" class="contact-avatar" />
                {:else}
                  <div class="contact-avatar-placeholder">👤</div>
                {/if}
                <div class="contact-details">
                  <div class="contact-name">
                    {contact.profile?.display_name || contact.profile?.name || contact.petname || 'Anonymous'}
                  </div>
                  <div class="contact-pubkey" title={formatFullPubkey(contact.pubkey)}>
                    {formatPubkey(contact.pubkey)}
                  </div>
                  {#if contact.profile?.about}
                    <div class="contact-about">{contact.profile.about}</div>
                  {/if}
                  {#if contact.profile?.nip05}
                    <div class="contact-nip05">✓ {contact.profile.nip05}</div>
                  {/if}
                </div>
              </div>
              <button 
                class="btn-remove" 
                on:click={() => removeContact(contact.pubkey)}
                disabled={isLoading}
                title="Remove contact"
              >
                ✕
              </button>
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

  .stat-link {
    text-decoration: none;
    color: inherit;
    display: block;
    transition: all 0.2s;
    cursor: pointer;
  }

  .stat-link:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(102, 126, 234, 0.2);
  }

  .external-icon {
    font-size: 14px;
    color: #667eea;
    opacity: 0.6;
    margin-left: 4px;
    transition: opacity 0.2s, transform 0.2s;
    display: inline-block;
  }

  .stat-link:hover .external-icon {
    opacity: 1;
    transform: translate(2px, -2px);
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

  .contacts-container {
    background: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .contacts-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    gap: 20px;
    flex-wrap: wrap;
  }

  .contacts-header h2 {
    margin: 0;
    color: #333;
    font-size: 24px;
  }

  .search-input {
    padding: 10px 16px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 14px;
    min-width: 250px;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    outline: none;
    border-color: #667eea;
  }

  .loading, .empty {
    text-align: center;
    padding: 40px;
    color: #888;
    font-size: 16px;
  }

  .contacts-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .contact-item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px;
    border: 2px solid #f0f0f0;
    border-radius: 12px;
    transition: all 0.2s;
  }

  .contact-item:hover {
    border-color: #667eea;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
  }

  .contact-info {
    display: flex;
    gap: 16px;
    flex: 1;
  }

  .contact-avatar, .contact-avatar-placeholder {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .contact-avatar-placeholder {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
  }

  .contact-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .contact-name {
    font-weight: bold;
    font-size: 16px;
    color: #333;
  }

  .contact-pubkey {
    font-size: 12px;
    color: #888;
    font-family: monospace;
  }

  .contact-about {
    font-size: 14px;
    color: #666;
    line-height: 1.5;
    margin-top: 4px;
  }

  .contact-nip05 {
    font-size: 13px;
    color: #667eea;
    margin-top: 4px;
  }

  .btn-remove {
    padding: 8px 12px;
    background: #ff4444;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    transition: background-color 0.2s;
    flex-shrink: 0;
  }

  .btn-remove:hover:not(:disabled) {
    background: #cc0000;
  }

  .btn-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    main {
      padding: 10px;
    }

    .contacts-header {
      flex-direction: column;
      align-items: stretch;
    }

    .search-input {
      min-width: 100%;
    }

    .contact-item {
      flex-direction: column;
      gap: 12px;
    }

    .btn-remove {
      align-self: flex-end;
    }
  }
</style>
