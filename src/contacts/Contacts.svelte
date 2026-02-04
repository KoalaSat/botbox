<script lang="ts">
  import { onMount } from "svelte";
  import { sendToBackground } from "../shared/messaging";
  import { MessageType } from "../shared/messaging";
  import type { UserData, StoredContact } from "../services/db";
  import { nip19 } from "nostr-tools";
  import { X, User, ExternalLink } from 'lucide-svelte';
  import { filterContacts } from './contactUtils';
  import { formatPubkey } from '../shared/formatters';
  import './contacts.css';

  let isLoggedIn = false;
  let isLoading = false;
  let error = "";
  let userData: UserData | null = null;
  let contacts: StoredContact[] = [];
  let isFetchingContacts = false;
  let searchTerm = "";
  let filteredContacts: StoredContact[] = [];

  function updateFilteredContacts() {
    filteredContacts = filterContacts(contacts, searchTerm);
  }

  /**
   * Handle storage changes - refresh data when updated
   */
  async function handleStorageChange(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) {
    if (areaName !== "local") return;

    // Check if userData or contactProfiles were updated
    if (changes.userData || changes.contactProfiles) {
      console.log("Storage changed, refreshing UI...");

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
      console.error("Error checking login status:", err);
    }
  }

  export async function fetchContacts() {
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
      console.error("Error fetching contacts:", err);
    } finally {
      isFetchingContacts = false;
    }
  }

</script>

<div class="page-view">
  {#if error}
    <div class="error">
      {error}
      <button on:click={() => (error = "")}><X size={18} /></button>
    </div>
  {/if}

  {#if !isLoggedIn}
    <div class="login-container">
      <p class="info">You need to be logged in to view your contacts.</p>
      <p class="info-small">
        Please open the extension popup and login with your npub, pubkey, or NIP-05 address.
      </p>
    </div>
  {:else}
    <div class="page-container">
      <div class="page-header">
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
        <div class="item-list">
          {#each filteredContacts as contact (contact.pubkey)}
            <div class="contact-item">
              <div class="contact-info">
                {#if contact.profile?.picture}
                  <img
                    src={contact.profile.picture}
                    alt="Profile"
                    class="contact-avatar"
                  />
                {:else}
                  <div class="contact-avatar-placeholder"><User size={20} /></div>
                {/if}
                <div class="contact-details">
                  <div class="contact-name">
                    {contact.profile?.display_name ||
                      contact.profile?.name ||
                      contact.petname ||
                      "Anonymous"}
                  </div>
                  <div
                    class="pubkey"
                    title={nip19.npubEncode(contact.pubkey)}
                  >
                    {formatPubkey(contact.pubkey)}
                  </div>
                </div>
              </div>
              <div class="contact-actions">
                <button
                  class="btn-small"
                  on:click={() => window.open(`https://njump.me/${nip19.npubEncode(contact.pubkey)}`, '_blank')}
                  title="View profile on njump.me"
                >
                  <ExternalLink size={16} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

