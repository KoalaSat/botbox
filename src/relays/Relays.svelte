<script lang="ts">
  import { onMount } from "svelte";
  import { sendToBackground } from "../shared/messaging";
  import { MessageType } from "../shared/messaging";
  import type { UserData, RelayMetadata } from "../services/db";
  import { X, Plus, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Loader, ExternalLink } from 'lucide-svelte';
  import { 
    getRelayTypeLabel, 
    getRelayTypeIcon, 
    getRelayTypeColor, 
    filterRelays,
    validateRelayUrl,
    type RelayType 
  } from './relayUtils';
  import './relays.css';

  let isLoggedIn = false;
  let isLoading = false;
  let error = "";
  let userData: UserData | null = null;
  let relays: RelayMetadata[] = [];
  let isFetchingRelays = false;
  let searchTerm = "";
  let filteredRelays: RelayMetadata[] = [];
  let showAddRelayForm = false;
  let newRelayUrl = "";
  let newRelayType: RelayType = 'both';
  let isAddingRelay = false;

  function updateFilteredRelays() {
    filteredRelays = filterRelays(relays, searchTerm);
  }

  /**
   * Handle storage changes - refresh data when updated
   */
  async function handleStorageChange(
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) {
    if (areaName !== "local") return;

    // Check if userData was updated
    if (changes.userData) {
      const oldRelayMetadata = changes.userData.oldValue?.relayMetadata;
      const newRelayMetadata = changes.userData.newValue?.relayMetadata;
      
      // Update relay list if relay metadata changed (e.g., NIP-11 info fetched)
      if (JSON.stringify(oldRelayMetadata) !== JSON.stringify(newRelayMetadata)) {
        console.log("Relay metadata changed, refreshing UI...");
        relays = newRelayMetadata || [];
        updateFilteredRelays();
      }
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

        if (isLoggedIn && relays.length === 0) {
          // Only fetch relays if we don't have any yet
          await fetchRelays();
        }
      }
    } catch (err) {
      console.error("Error checking login status:", err);
    }
  }

  export async function fetchRelays() {
    if (isFetchingRelays) return; // Prevent concurrent fetches
    
    isFetchingRelays = true;
    try {
      const response = await sendToBackground({
        type: MessageType.FETCH_RELAYS,
      });

      if (response.success) {
        relays = response.data || [];
        updateFilteredRelays();
      }
    } catch (err) {
      console.error("Error fetching relays:", err);
    } finally {
      isFetchingRelays = false;
    }
  }

  async function removeRelay(url: string) {
    if (!confirm("Are you sure you want to remove this relay?")) {
      return;
    }

    isLoading = true;
    error = "";
    try {
      const response = await sendToBackground({
        type: MessageType.REMOVE_RELAY,
        payload: { url },
      });

      if (response.success) {
        relays = response.data || [];
        updateFilteredRelays();
        
        // Auto-publish to Nostr
        await autoPublishRelayList();
      } else {
        throw new Error(response.error || "Failed to remove relay");
      }
    } catch (err) {
      console.error("Error removing relay:", err);
      error = err instanceof Error ? err.message : "Failed to remove relay";
      await fetchRelays();
    } finally {
      isLoading = false;
    }
  }

  async function updateRelayType(url: string, type: RelayType) {
    isLoading = true;
    error = "";
    try {
      const response = await sendToBackground({
        type: MessageType.UPDATE_RELAY_TYPE,
        payload: { url, type },
      });

      if (response.success) {
        relays = response.data || [];
        updateFilteredRelays();
        
        // Auto-publish to Nostr
        await autoPublishRelayList();
      } else {
        throw new Error(response.error || "Failed to update relay type");
      }
    } catch (err) {
      console.error("Error updating relay type:", err);
      error = err instanceof Error ? err.message : "Failed to update relay type";
      await fetchRelays();
    } finally {
      isLoading = false;
    }
  }

  async function addRelay() {
    const validation = validateRelayUrl(newRelayUrl);
    if (!validation.valid) {
      error = validation.error || "Invalid relay URL";
      return;
    }

    isAddingRelay = true;
    error = "";
    
    try {
      const response = await sendToBackground({
        type: MessageType.ADD_RELAY,
        payload: {
          url: newRelayUrl.trim(),
          type: newRelayType,
        },
      });

      if (response.success) {
        // Reset form
        newRelayUrl = "";
        newRelayType = 'both';
        showAddRelayForm = false;
        
        // Refresh relay list
        relays = response.data || [];
        updateFilteredRelays();
        
        // Auto-publish to Nostr
        await autoPublishRelayList();
      } else {
        throw new Error(response.error || "Failed to add relay");
      }
    } catch (err) {
      console.error("Error adding relay:", err);
      error = err instanceof Error ? err.message : "Failed to add relay";
    } finally {
      isAddingRelay = false;
    }
  }

  async function autoPublishRelayList() {
    try {
      await sendToBackground({
        type: MessageType.PUBLISH_RELAY_LIST,
      });
      console.log("Relay list auto-published to Nostr");
    } catch (err) {
      console.error("Error auto-publishing relay list:", err);
      // Don't show error to user, this is automatic
    }
  }

  function cancelAddRelay() {
    showAddRelayForm = false;
    newRelayUrl = "";
    newRelayType = 'both';
    error = "";
  }

  $: {
    searchTerm;
    updateFilteredRelays();
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
      <p class="info">You need to be logged in to manage your relays.</p>
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
          placeholder="Search relays..."
          bind:value={searchTerm}
          on:input={updateFilteredRelays}
        />
        <button
          class={showAddRelayForm ? "btn-cancel" : "btn-success"}
          on:click={() => showAddRelayForm = !showAddRelayForm}
          disabled={isLoading || isAddingRelay}
        >
          {#if showAddRelayForm}
            <X size={16} /> Cancel
          {:else}
            <Plus size={16} /> Add Relay
          {/if}
        </button>
      </div>

      {#if showAddRelayForm}
        <div class="form-container">
          <h3>Add New Relay</h3>
          <p class="form-help">
            Add a relay URL and specify whether it's for reading (inbox), writing (outbox), or both.
            <br />
            <strong>NIP-65 Recommendation:</strong> Keep your list small (2-4 relays per category).
          </p>
          <div class="form-group">
            <label for="relay-url">Relay URL</label>
            <input
              id="relay-url"
              type="text"
              class="form-input"
              placeholder="wss://relay.example.com"
              bind:value={newRelayUrl}
              disabled={isAddingRelay}
            />
          </div>
          <div class="form-group">
            <label for="relay-type">Relay Type</label>
            <select
              id="relay-type"
              class="form-select"
              bind:value={newRelayType}
              disabled={isAddingRelay}
            >
              <option value="both">Both (Read & Write)</option>
              <option value="read">Inbox (Read) - For mentions/DMs</option>
              <option value="write">Outbox (Write) - For publishing</option>
            </select>
            <p class="form-help-small">
              {#if newRelayType === 'read'}
                <ArrowDownToLine size={14} style="display: inline; vertical-align: middle;" />
                Inbox relays are where others will look for events about you (mentions, tags).
              {:else if newRelayType === 'write'}
                <ArrowUpFromLine size={14} style="display: inline; vertical-align: middle;" />
                Outbox relays are where you publish your events.
              {:else}
                <RefreshCw size={14} style="display: inline; vertical-align: middle;" />
                This relay will be used for both reading and writing.
              {/if}
            </p>
          </div>
          <div class="form-actions">
            <button
              class="btn-primary"
              on:click={addRelay}
              disabled={isAddingRelay || !newRelayUrl.trim()}
            >
              {#if isAddingRelay}
                <Loader size={16} class="spin" /> Adding...
              {:else}
                <Plus size={16} /> Add Relay
              {/if}
            </button>
          </div>
        </div>
      {/if}

      {#if isFetchingRelays}
        <div class="loading">Loading relays...</div>
      {:else if relays.length === 0}
        <div class="empty">No relays configured. Add your first relay above!</div>
      {:else if filteredRelays.length === 0}
        <div class="empty">No relays match your search</div>
      {:else}
        <div class="item-list">
          {#each filteredRelays as relay (relay.url)}
            <div class="relay-item">
              <div class="relay-info">
                {#if relay.info?.icon}
                  <div class="relay-icon-image">
                    <img src={relay.info.icon} alt={relay.info.name || relay.url} />
                  </div>
                {:else}
                  <div class="relay-icon" style="background-color: {getRelayTypeColor(relay.type)};">
                    <svelte:component this={getRelayTypeIcon(relay.type)} size={20} />
                  </div>
                {/if}
                <div class="relay-details">
                  <div class="relay-url">
                    {#if relay.info?.name}
                      <span class="relay-name">{relay.info.name}</span>
                      <span class="relay-url-secondary">{relay.url}</span>
                    {:else}
                      {relay.url}
                    {/if}
                  </div>
                </div>
                <div class="relay-actions">
                  <select
                    class="relay-type-select"
                    value={relay.type}
                    on:change={(e) => updateRelayType(relay.url, e.currentTarget.value as RelayType)}
                    disabled={isLoading}
                    title="Change relay type"
                  >
                    <option value="both">Both (Read & Write)</option>
                    <option value="read">Inbox (Read) - For mentions/DMs</option>
                    <option value="write">Outbox (Write) - For publishing</option>
                  </select>
                  <button
                    class="btn-remove"
                    on:click={() => removeRelay(relay.url)}
                    disabled={isLoading}
                    title="Remove relay"
                  >
                    <X size={16} />
                  </button>
                  <button
                    class="btn-small"
                    on:click={() => window.open(relay.url.replace('wss://', 'https://').replace('ws://', 'http://'), '_blank')}
                    title="Open relay website"
                  >
                    <ExternalLink size={16} />
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

