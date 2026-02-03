<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { X, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-svelte';
  import { formatPubkey } from '../shared/formatters';
  import { Database } from '../services/db';
  import { nip19 } from 'nostr-tools';
  import './localRelayEvents.css';

  interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }

  let events: NostrEvent[] = [];
  let filteredEvents: NostrEvent[] = [];
  let isLoading = false;
  let error = '';
  let ws: WebSocket | null = null;
  let searchTerm = '';
  let selectedKinds: number[] = [];
  let expandedEventId: string | null = null;
  let isConnected = false;
  let relayUrl: string | null = null;
  let userPubkey: string | null = null;

  onMount(async () => {
    await loadUserData();
    await loadRelayUrl();
    if (relayUrl) {
      connectToRelay();
    }
  });

  async function loadUserData() {
    const userData = await Database.getUserData();
    if (userData) {
      userPubkey = userData.pubkey;
    }
  }

  async function loadRelayUrl() {
    relayUrl = await Database.getAppRelayUrl();
  }

  onDestroy(() => {
    closeConnection();
  });

  function connectToRelay() {
    if (!relayUrl) {
      error = 'App relay not configured';
      return;
    }

    isLoading = true;
    error = '';

    try {
      ws = new WebSocket(relayUrl);

      ws.onopen = () => {
        console.log('[LocalRelayEvents] Connected to relay:', relayUrl);
        isConnected = true;
        isLoading = false;
        
        // Request all events
        fetchEvents();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleRelayMessage(message);
        } catch (err) {
          console.error('[LocalRelayEvents] Error parsing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[LocalRelayEvents] WebSocket error:', err);
        error = `Failed to connect to relay. Make sure ${relayUrl} is accessible.`;
        isLoading = false;
        isConnected = false;
      };

      ws.onclose = () => {
        console.log('[LocalRelayEvents] Disconnected from relay');
        isConnected = false;
      };
    } catch (err) {
      console.error('[LocalRelayEvents] Connection error:', err);
      error = 'Failed to connect to relay';
      isLoading = false;
    }
  }

  function handleRelayMessage(message: any[]) {
    const [type, ...args] = message;

    switch (type) {
      case 'EVENT':
        const [subscriptionId, event] = args;
        // Add event if it doesn't exist
        if (!events.find(e => e.id === event.id)) {
          events = [event, ...events];
          updateFilteredEvents();
        }
        break;
      
      case 'EOSE':
        console.log('[LocalRelayEvents] End of stored events');
        isLoading = false;
        break;
      
      case 'NOTICE':
        console.log('[LocalRelayEvents] Notice:', args[0]);
        break;
    }
  }

  function fetchEvents() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      error = 'Not connected to relay';
      return;
    }

    if (!userPubkey) {
      error = 'User not logged in';
      return;
    }

    isLoading = true;
    events = [];
    
    // Send REQ message to fetch only events from the current user
    const subscriptionId = 'local-relay-events-' + Date.now();
    const filter = { authors: [userPubkey] };
    const req = JSON.stringify(['REQ', subscriptionId, filter]);
    ws.send(req);
  }

  function closeConnection() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function updateFilteredEvents() {
    filteredEvents = events.filter(event => {
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
      0: 'Profile',
      1: 'Note',
      3: 'Contacts',
      4: 'Encrypted DM',
      5: 'Event Deletion',
      6: 'Repost',
      7: 'Reaction',
      10002: 'Relay List',
      30023: 'Long-form',
    };
    return kindLabels[kind] || `Kind ${kind}`;
  }

  function getUniqueKinds(): number[] {
    const kinds = new Set(events.map(e => e.kind));
    return Array.from(kinds).sort((a, b) => a - b);
  }

  function toggleKindFilter(kind: number) {
    if (selectedKinds.includes(kind)) {
      selectedKinds = selectedKinds.filter(k => k !== kind);
    } else {
      selectedKinds = [...selectedKinds, kind];
    }
    updateFilteredEvents();
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  function formatNpub(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return formatPubkey(pubkey);
    }
  }

  function toggleEventExpansion(eventId: string) {
    expandedEventId = expandedEventId === eventId ? null : eventId;
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function refreshEvents() {
    closeConnection();
    connectToRelay();
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
      <button on:click={() => error = ''}><X size={18} /></button>
    </div>
  {/if}

  <div class="page-container">
    <div class="page-header">
      <div class="connection-status">
        <span class="status-indicator" class:connected={isConnected}></span>
        <span class="status-text">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <button
        class="btn-primary"
        on:click={refreshEvents}
        disabled={isLoading}
        title="Refresh events"
      >
        {#if isLoading}
          <RefreshCw size={16} class="spin" /> Loading...
        {:else}
          <RefreshCw size={16} /> Refresh
        {/if}
      </button>
    </div>

    <div class="filters">
      <input
        type="text"
        class="search-input"
        placeholder="Search events..."
        bind:value={searchTerm}
      />
      
      {#if getUniqueKinds().length > 0}
        <div class="kind-filters">
          <span class="filter-label">Filter by kind:</span>
          {#each getUniqueKinds() as kind}
            <button
              class="kind-filter-btn"
              class:active={selectedKinds.includes(kind)}
              on:click={() => toggleKindFilter(kind)}
            >
              {getKindLabel(kind)} ({events.filter(e => e.kind === kind).length})
            </button>
          {/each}
        </div>
      {/if}
    </div>

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
        No events received yet. Events will appear here when sent to the local relay.
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
              on:keydown={(e) => e.key === 'Enter' && toggleEventExpansion(event.id)}
              role="button"
              tabindex="0"
            >
              <div class="event-meta">
                <span class="event-kind">{getKindLabel(event.kind)}</span>
                <span class="event-time">{formatTimestamp(event.created_at)}</span>
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
                    <pre class="json-display">{JSON.stringify(event, null, 2)}</pre>
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
