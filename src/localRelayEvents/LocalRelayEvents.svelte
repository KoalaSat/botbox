<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { X, RefreshCw, Trash2, ChevronDown, ChevronUp } from "lucide-svelte";
  import { formatPubkey } from "../shared/formatters";
  import { Database } from "../services/db";
  import { sendToBackground, MessageType } from "../shared/messaging";
  import { nip19, type Event as NostrEvent } from "nostr-tools";
  import "./localRelayEvents.css";

  let events: NostrEvent[] = [];
  let filteredEvents: NostrEvent[] = [];
  let isLoading = false;
  let error = "";
  let searchTerm = "";
  let selectedKinds: number[] = [];
  let expandedEventId: string | null = null;
  let isConnected = false;
  let relayUrl: string | null = null;
  let userPubkey: string | null = null;
  let pollInterval: number;

  onMount(async () => {
    await loadUserData();
    await loadRelayUrl();
    await fetchEvents();

    // Poll for new events every 2 seconds
    pollInterval = window.setInterval(fetchEvents, 2000);
  });

  async function loadUserData() {
    const userData = await Database.getUserData();
    if (userData) {
      userPubkey = userData.pubkey;
    }
  }

  async function loadRelayUrl() {
    relayUrl = await Database.getConsistencyRelayUrl();
  }

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  async function fetchEvents() {
    try {
      // Check connection status first
      const statusResponse = await sendToBackground({
        type: MessageType.GET_CONSISTENCY_RELAY_STATUS,
      });

      if (statusResponse.success) {
        isConnected = statusResponse.data.connected;
      }

      // Then fetch events
      const response = await sendToBackground({
        type: MessageType.GET_CONSISTENCY_RELAY_EVENTS,
      });

      if (response.success) {
        events = response.data || [];
        error = "";
        updateFilteredEvents();
      } else {
        throw new Error(response.error || "Failed to fetch events");
      }
    } catch (err) {
      console.error("Error fetching events:", err);
      error = err instanceof Error ? err.message : "Failed to fetch events";
      isConnected = false;
    } finally {
      isLoading = false;
    }
  }

  function updateFilteredEvents() {
    filteredEvents = events.filter((event) => {
      // Filter by search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesId = event.id.toLowerCase().includes(term);
        const matchesPubkey = event.pubkey.toLowerCase().includes(term);
        const matchesContent = event.content.toLowerCase().includes(term);

        if (!matchesId && !matchesPubkey && !matchesContent) {
          return false;
        }
      }

      // Filter by kind
      if (selectedKinds.length > 0 && !selectedKinds.includes(event.kind)) {
        return false;
      }

      return true;
    });
  }

  function getKindLabel(kind: number): string {
    const kindLabels: Record<number, string> = {
      0: "Profile",
      1: "Note",
      3: "Contacts",
      4: "Encrypted DM",
      5: "Event Deletion",
      6: "Repost",
      7: "Reaction",
      10002: "Relay List",
      30023: "Long-form",
    };
    return kindLabels[kind] || `Kind ${kind}`;
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function toggleEventExpansion(eventId: string) {
    expandedEventId = expandedEventId === eventId ? null : eventId;
  }

  $: {
    searchTerm;
    selectedKinds;
    updateFilteredEvents();
  }
</script>

<div class="page-view">
  {#if error}
    <div class="error">
      {error}
      <button on:click={() => (error = "")}><X size={18} /></button>
    </div>
  {/if}
  <div class="page-container">
    <input
      type="text"
      class="search-input"
      placeholder="Search events..."
      bind:value={searchTerm}
    />
    <div class="stats-bar">
      <div class="stat-item">
        <strong>{events.length}</strong> total events
      </div>
      <div class="stat-item">
        <strong>{filteredEvents.length}</strong> displayed
      </div>
    </div>

    {#if isLoading}
      <div class="loading">Loading events...</div>
    {:else if events.length === 0}
      <div class="empty">
        No events received yet. Events will appear here when sent to the
        consistency relay.
      </div>
    {:else if filteredEvents.length === 0}
      <div class="empty">No events match your filters</div>
    {:else}
      <div class="item-list">
        {#each filteredEvents as event (event.id)}
          <div class="event-item">
            <div
              class="event-header"
              on:click={() => toggleEventExpansion(event.id)}
              on:keydown={(e) =>
                e.key === "Enter" && toggleEventExpansion(event.id)}
              role="button"
              tabindex="0"
            >
              <div class="event-meta">
                <span class="event-kind">{getKindLabel(event.kind)}</span>
                <span class="event-time"
                  >{formatTimestamp(event.created_at)}</span
                >
              </div>
              <button class="expand-btn">
                {#if expandedEventId === event.id}
                  <ChevronUp size={16} />
                {:else}
                  <ChevronDown size={16} />
                {/if}
              </button>
            </div>

            <div class="event-body">
              {#if event.content}
                <div class="event-field">
                  <span class="field-label">Content:</span>
                  <span class="field-value content-preview">
                    {event.content.substring(0, 200)}
                    {#if event.content.length > 200}...{/if}
                  </span>
                </div>
              {/if}

              {#if expandedEventId === event.id}
                <div class="event-details">
                  <div class="event-field">
                    <span class="field-label">Event ID:</span>
                    <span class="field-value mono">
                      {event.id}
                    </span>
                  </div>

                  {#if event.tags.length > 0}
                    <div class="event-field">
                      <span class="field-label">Tags:</span>
                      <div class="tags-list">
                        {#each event.tags as tag}
                          <div class="tag-item">{JSON.stringify(tag)}</div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <div class="event-field">
                    <span class="field-label">Full Event JSON:</span>
                    <pre class="json-display">{JSON.stringify(
                        event,
                        null,
                        2,
                      )}</pre>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
