<script lang="ts">
  import { onMount } from "svelte";
  import { sendToBackground } from "../shared/messaging";
  import { MessageType } from "../shared/messaging";
  import type { UserData, StoredContact } from "../services/db";
  import { nip19 } from "nostr-tools";
  import { X, UserPlus, User, ExternalLink, Check, Loader } from 'lucide-svelte';
  import { filterContacts, parseContactIdentifier } from './contactUtils';
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
  let showAddContactForm = false;
  let newContactIdentifier = "";
  let isAddingContact = false;

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

  async function refreshUserData() {
    isLoading = true;
    error = "";
    try {
      const response = await sendToBackground({
        type: MessageType.FETCH_USER_DATA,
      });

      if (response.success) {
        userData = response.data;
        await fetchContacts();
      } else {
        throw new Error(response.error || "Failed to refresh data");
      }
    } catch (err) {
      console.error("Error refreshing data:", err);
      error = err instanceof Error ? err.message : "Failed to refresh data";
    } finally {
      isLoading = false;
    }
  }

  async function removeContact(pubkey: string) {
    if (
      !confirm(
        "Are you sure you want to remove this contact? This will publish a new contact list to the relays.",
      )
    ) {
      return;
    }

    isLoading = true;
    error = "";
    try {
      const response = await sendToBackground({
        type: MessageType.REMOVE_CONTACT,
        payload: { pubkey },
      });

      if (response.success) {
        // Immediately update the local state by filtering out the removed contact
        contacts = contacts.filter(c => c.pubkey !== pubkey);
        updateFilteredContacts();
        
        // Also fetch fresh data from the background to ensure consistency
        await fetchContacts();
      } else {
        throw new Error(response.error || "Failed to remove contact");
      }
    } catch (err) {
      console.error("Error removing contact:", err);
      error = err instanceof Error ? err.message : "Failed to remove contact";
      // Restore the contacts list on error by re-fetching
      await fetchContacts();
    } finally {
      isLoading = false;
    }
  }

  async function addContact() {
    const parsed = parseContactIdentifier(newContactIdentifier);
    if (parsed.error) {
      error = parsed.error;
      return;
    }

    isAddingContact = true;
    error = "";
    
    try {
      const pubkey = parsed.pubkey!;
      
      const response = await sendToBackground({
        type: MessageType.ADD_CONTACT,
        payload: {
          identifier: pubkey,
        },
      });

      if (response.success) {
        // Reset form
        newContactIdentifier = "";
        showAddContactForm = false;
        
        // Refresh contacts list
        await fetchContacts();
      } else {
        throw new Error(response.error || "Failed to add contact");
      }
    } catch (err) {
      console.error("Error adding contact:", err);
      error = err instanceof Error ? err.message : "Failed to add contact";
    } finally {
      isAddingContact = false;
    }
  }

  function cancelAddContact() {
    showAddContactForm = false;
    newContactIdentifier = "";
    error = "";
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
        Please open the extension popup and login with your NIP-07 extension.
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
        <button
          class={showAddContactForm ? "btn-cancel" : "btn-success"}
          on:click={() => showAddContactForm = !showAddContactForm}
          disabled={isLoading || isAddingContact}
        >
          {#if showAddContactForm}
            <X size={16} /> Cancel
          {:else}
            <UserPlus size={16} /> Add Contact
          {/if}
        </button>
      </div>

      {#if showAddContactForm}
        <div class="form-container">
          <h3>Add New Contact</h3>
          <p class="form-help">
            Enter a pubkey (hex), npub, or NIP-05 address (e.g., user@domain.com)
          </p>
          <div class="form-group">
            <label for="contact-identifier">Pubkey / Npub / NIP-05</label>
            <input
              id="contact-identifier"
              type="text"
              class="form-input"
              placeholder="npub1... or user@domain.com or hex pubkey"
              bind:value={newContactIdentifier}
              disabled={isAddingContact}
            />
          </div>
          <div class="form-actions">
            <button
              class="btn-primary"
              on:click={addContact}
              disabled={isAddingContact || !newContactIdentifier.trim()}
            >
              {#if isAddingContact}
                <Loader size={16} class="spin" /> Adding...
              {:else}
                <Check size={16} /> Add Contact
              {/if}
            </button>
          </div>
        </div>
      {/if}

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
                  class="btn-remove"
                  on:click={() => removeContact(contact.pubkey)}
                  disabled={isLoading}
                  title="Remove contact"
                >
                  <X size={16} />
                </button>
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

