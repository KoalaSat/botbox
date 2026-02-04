<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    X,
    RefreshCw,
    Trash2,
    ChevronDown,
    ChevronUp,
    User,
    MessageSquare,
    Users,
    Lock,
    Repeat,
    Heart,
    Radio,
    FileText,
    Hash,
    ExternalLink,
  } from "lucide-svelte";
  import { formatPubkey } from "../shared/formatters";
  import { Database } from "../services/db";
  import { sendToBackground, MessageType } from "../shared/messaging";
  import { nip19, type Event as NostrEvent } from "nostr-tools";
  import "./relayEvents.css";

  type EventWithRelayCount = NostrEvent & { relayCount?: number };

  let events: EventWithRelayCount[] = [];
  let filteredEvents: EventWithRelayCount[] = [];
  let isLoading = false;
  let error = "";
  let searchTerm = "";
  let selectedKinds: number[] = [];
  let expandedEventId: string | null = null;
  let totalConnected = 0;
  let totalRelays = 0;
  let totalEoseReceived = 0;
  let userPubkey: string | null = null;
  let pollInterval: number;

  onMount(async () => {
    await loadUserData();
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

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  async function fetchEvents() {
    try {
      // Check connection status first
      const statusResponse = await sendToBackground({
        type: MessageType.GET_OUTBOX_MODEL_STATUS,
      });

      if (statusResponse.success && statusResponse.data) {
        totalConnected = statusResponse.data.totalConnected || 0;
        totalRelays = statusResponse.data.totalRelays || 0;
        totalEoseReceived = statusResponse.data.totalEoseReceived || 0;
      }

      // Then fetch events
      const response = await sendToBackground({
        type: MessageType.GET_OUTBOX_MODEL_EVENTS,
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
      totalConnected = 0;
      totalRelays = 0;
    } finally {
      isLoading = false;
    }
  }

  function updateFilteredEvents() {
    filteredEvents = events
      .filter((event) => {
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
      })
      .sort((a, b) => b.created_at - a.created_at);
  }

  function getKindIcon(kind: number) {
    const kindIcons: Record<number, any> = {
      0: User, // Profile
      1: MessageSquare, // Note
      3: Users, // Contacts
      4: Lock, // Encrypted DM
      5: Trash2, // Event Deletion
      6: Repeat, // Repost
      7: Heart, // Reaction
      10002: Radio, // Relay List
      30023: FileText, // Long-form
    };
    return kindIcons[kind] || Hash; // Default icon for unknown kinds
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
    <div class="stats-header">
      {#if isLoading}
        <div class="stat-item">
          <RefreshCw size={14} class="spin" />
          <span class="stat-text"
            >Connecting</span
          >
        </div>
      {:else}
        <div class="stat-item">
          <span
            class="status-indicator"
            class:connected={totalConnected > 0}
            class:disconnected={totalConnected === 0}
          ></span>
          <span class="stat-text">{totalConnected} relays</span>
        </div>
      {/if}
      <div class="stat-item">
        <span class="stat-text">{events.length} total</span>
      </div>
      <div class="stat-item">
        <span class="stat-text">{filteredEvents.length} displayed</span>
      </div>
    </div>

    <div class="search-bar">
      <input
        type="text"
        class="search-input"
        placeholder="Search events..."
        bind:value={searchTerm}
      />
    </div>

    {#if isLoading}
      <div class="loading">
        <RefreshCw size={48} class="spin" />
        <h2>Initializing Outbox Model</h2>
        <p>Connecting to relays and loading events...</p>
      </div>
    {:else if events.length === 0}
      <div class="empty">
        {#if totalConnected === 0 && totalRelays === 0}
          <RefreshCw size={48} class="spin" />
          <h2>Setting Up Relay Connections</h2>
          <p>Fetching your relay list...</p>
          <p class="empty-hint">
            Please wait while we discover your outbox relays.
          </p>
        {:else if totalConnected === 0}
          <RefreshCw size={48} class="spin" />
          <h2>Connecting to Relays</h2>
          <p>
            Establishing WebSocket connections to {totalRelays} relay{totalRelays !==
            1
              ? "s"
              : ""}...
          </p>
          <p class="empty-hint">This may take a few moments.</p>
        {:else if totalConnected < totalRelays}
          <RefreshCw size={48} class="spin" />
          <h2>Connecting to Relays</h2>
          <p>
            <strong>{totalConnected} of {totalRelays}</strong> relays connected
          </p>
          <p class="empty-hint">
            Subscribing to events and waiting for data...
          </p>
        {:else}
          <h2>✓ All Relays Connected</h2>
          <p>
            <strong
              >{totalConnected} relay{totalConnected !== 1 ? "s" : ""}</strong
            > are listening for events
          </p>
          <p class="empty-hint">
            No events received yet. New events will appear here automatically.
          </p>
        {/if}
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
                <span
                  class="event-kind"
                  class:user-event={event.pubkey === userPubkey}
                  title={getKindLabel(event.kind)}
                >
                  <svelte:component this={getKindIcon(event.kind)} size={16} />
                </span>
                <span class="event-time"
                  >{formatTimestamp(event.created_at)}</span
                >
                {#if event.relayCount}
                  <span
                    class="relay-count"
                    title="Found on {event.relayCount} relay{event.relayCount !==
                    1
                      ? 's'
                      : ''}"
                  >
                    {event.relayCount} 🔄
                  </span>
                {/if}
                <button
                  class="external-link-btn"
                  on:click|stopPropagation={() =>
                    window.open(
                      `https://njump.me/${nip19.noteEncode(event.id)}`,
                      "_blank",
                    )}
                  title="View event on njump.me"
                >
                  <ExternalLink size={14} />
                </button>
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
