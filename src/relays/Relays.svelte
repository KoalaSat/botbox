<script lang="ts">
  import { onMount } from "svelte";
  import { sendToBackground } from "../shared/messaging";
  import { MessageType } from "../shared/messaging";
  import type { UserData, RelayMetadata } from "../services/db";
  import { X, ExternalLink } from "lucide-svelte";
  import {
    getRelayTypeIcon,
    getRelayTypeColor,
    filterRelays,
  } from "./relayUtils";
  import "./relays.css";

  let isLoggedIn = false;
  let error = "";
  let userData: UserData | null = null;
  let relays: RelayMetadata[] = [];
  let isFetchingRelays = false;
  let searchTerm = "";
  let filteredRelays: RelayMetadata[] = [];

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
      if (
        JSON.stringify(oldRelayMetadata) !== JSON.stringify(newRelayMetadata)
      ) {
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
      <p class="info">You need to be logged in to view your relays.</p>
      <p class="info-small">
        Please open the extension popup and login with your npub, pubkey, or
        NIP-05 address.
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
      </div>

      {#if isFetchingRelays}
        <div class="loading">Loading relays...</div>
      {:else if relays.length === 0}
        <div class="empty">No relays configured</div>
      {:else if filteredRelays.length === 0}
        <div class="empty">No relays match your search</div>
      {:else}
        <div class="item-list">
          {#each filteredRelays as relay (relay.url)}
            <div class="relay-item">
              <div class="relay-info">
                {#if relay.info?.icon}
                  <div class="relay-icon-image">
                    <img
                      src={relay.info.icon}
                      alt={relay.info.name || relay.url}
                    />
                  </div>
                {:else}
                  <div
                    class="relay-icon"
                    style="background-color: {getRelayTypeColor(relay.type)};"
                  >
                    <svelte:component
                      this={getRelayTypeIcon(relay.type)}
                      size={20}
                    />
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
                  <div
                    class="relay-type-badge"
                    style="background-color: {getRelayTypeColor(relay.type)};"
                  >
                    {relay.type === "both"
                      ? "Read & Write"
                      : relay.type === "read"
                        ? "Inbox (Read)"
                        : "Outbox (Write)"}
                  </div>
                  <button
                    class="btn-small"
                    on:click={() =>
                      window.open(
                        relay.url
                          .replace("wss://", "https://")
                          .replace("ws://", "http://"),
                        "_blank",
                      )}
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
