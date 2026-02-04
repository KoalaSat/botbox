<script lang="ts">
  import { onMount } from "svelte";
  import { sendToBackground } from "../shared/messaging";
  import { MessageType } from "../shared/messaging";
  import type { UserData, StoredContact } from "../services/db";
  import { Database } from "../services/db";
  import Contacts from "../contacts/Contacts.svelte";
  import Relays from "../relays/Relays.svelte";
  import RelayEvents from "../relayEvents/RelayEvents.svelte";
  import InboxScanner from "../inboxScanner/InboxScanner.svelte";
  import {
    User,
    RefreshCw,
    LogOut,
    X,
    ExternalLink,
    ArrowLeft,
  } from "lucide-svelte";
  import { formatPubkey } from "../shared/formatters";

  let isLoggedIn = false;
  let isLoading = false;
  let error = "";
  let userData: UserData | null = null;
  let contacts: StoredContact[] = [];
  let isFetchingContacts = false;
  let currentView:
    | "home"
    | "contacts"
    | "relays"
    | "relayEvents"
    | "inboxScanner" = "home";
  let contactsComponent: Contacts;
  let relaysComponent: Relays;
  let relayEventsComponent: RelayEvents;
  let inboxScannerStatus: any = null;
  let isLoadingScanner = false;
  let loginIdentifier = "";

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
    // Check if already logged in and refresh data
    checkLoginStatus().then(async () => {
      if (isLoggedIn) {
        await refreshData();
      }
    });

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

      if (response && response.success && response.data) {
        isLoggedIn = response.data.isLoggedIn;
        userData = response.data.userData;

        if (isLoggedIn) {
          await fetchContacts();
        }
      } else if (response && !response.success) {
        console.warn("Failed to check login status:", response.error);
      }
    } catch (err) {
      console.error("Error checking login status:", err);
    }
  }

  async function handleLogin() {
    if (!loginIdentifier.trim()) {
      error = "Please enter a pubkey, npub, or NIP-05 address";
      return;
    }

    isLoading = true;
    error = "";

    try {
      // Send login request to background
      const loginResponse = await sendToBackground({
        type: MessageType.SIMPLE_LOGIN,
        payload: { identifier: loginIdentifier.trim() },
      });

      if (loginResponse.success) {
        userData = loginResponse.data;
        isLoggedIn = true;
        loginIdentifier = "";

        // Wait a bit for background to fetch data
        setTimeout(async () => {
          await fetchContacts();
        }, 2000);
      } else {
        throw new Error(loginResponse.error || "Login failed");
      }
    } catch (err) {
      console.error("Login error:", err);
      error = err instanceof Error ? err.message : "Unknown error occurred";
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
      console.error("Error fetching contacts:", err);
    } finally {
      isFetchingContacts = false;
    }
  }

  async function fetchInboxScannerStatus() {
    isLoadingScanner = true;
    try {
      const response = await sendToBackground({
        type: MessageType.GET_INBOX_SCANNER_STATUS,
      });

      if (response.success) {
        inboxScannerStatus = response.data;
      }
    } catch (err) {
      console.error("Error fetching inbox scanner status:", err);
    } finally {
      isLoadingScanner = false;
    }
  }

  function showInboxScanner() {
    currentView = "inboxScanner";
  }

  function formatTimeAgo(timestamp: number | null): string {
    if (!timestamp) return "Never";

    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  async function refreshData() {
    isLoading = true;
    error = "";
    try {
      const response = await sendToBackground({
        type: MessageType.REFRESH_DATA,
      });

      if (response.success) {
        userData = response.data;
        await fetchContacts();

        // Also refresh the current view's specific data
        if (currentView === "contacts" && contactsComponent) {
          await contactsComponent.fetchContacts();
        } else if (currentView === "relays" && relaysComponent) {
          await relaysComponent.fetchRelays();
        }
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

  async function handleLogout() {
    if (
      !confirm(
        "Are you sure you want to logout? This will clear all local data.",
      )
    ) {
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
        currentView = "home";
      }
    } catch (err) {
      console.error("Error logging out:", err);
    } finally {
      isLoading = false;
    }
  }

  function showContacts() {
    currentView = "contacts";
  }

  function showRelays() {
    currentView = "relays";
  }

  function showRelayEvents() {
    currentView = "relayEvents";
  }

  function showHome() {
    currentView = "home";
  }
</script>

<main>
  <div class="header">
    <h1>
      <img
        src="./icon-128.png"
        alt="BotBox"
        style="height: 42px; vertical-align: middle;"
      /> BotBox
    </h1>
  </div>

  {#if error}
    <div class="error">
      {error}
      <button on:click={() => (error = "")}><X size={18} /></button>
    </div>
  {/if}

  {#if !isLoggedIn}
    <div class="login-container">
      <p class="info">
        Login with your Nostr public key to view your profile and contacts.
      </p>
      <p class="info-small">
        Enter your npub, pubkey (hex), or NIP-05 address (user@domain.com)
      </p>
      <input
        type="text"
        class="login-input"
        placeholder="npub1... or user@domain.com or hex pubkey"
        bind:value={loginIdentifier}
        on:keydown={(e) => e.key === "Enter" && handleLogin()}
        disabled={isLoading}
      />
      <button
        class="btn-primary"
        on:click={handleLogin}
        disabled={isLoading || !loginIdentifier.trim()}
      >
        {isLoading ? "Logging in..." : "Login"}
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
            {userData?.profile?.display_name ||
              userData?.profile?.name ||
              "Anonymous"}
          </div>
          <div class="pubkey" title={userData?.pubkey}>
            {formatPubkey(userData?.pubkey || "")}
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
        <button class="btn-small" on:click={handleLogout} title="Logout">
          <LogOut size={16} />
        </button>
      </div>
    </div>

    {#if currentView === "home"}
      <div class="stats">
        <div
          class="stat stat-clickable"
          on:click={showContacts}
          on:keydown={(e) => e.key === "Enter" && showContacts()}
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
          on:keydown={(e) => e.key === "Enter" && showRelays()}
          role="button"
          tabindex="0"
          title="Click to view all relays"
        >
          <div class="stat-value">{userData?.relays.length || 0}</div>
          <div class="stat-label">Relays</div>
        </div>
        {#if userData?.lastUpdated}
          <div class="stat">
            <div class="stat-value-small">
              {new Date(userData.lastUpdated).toLocaleString()}
            </div>
            <div class="stat-label">Last Updated</div>
          </div>
        {/if}
      </div>

      <div
        class="info-box info-box-clickable"
        on:click={showRelayEvents}
        on:keydown={(e) => e.key === "Enter" && showRelayEvents()}
        role="button"
        tabindex="0"
        title="View relay events"
      >
        <div class="relay-info">
          <div class="relay-header">
            <span class="scanner-icon">📤</span>
            <strong>Outbox Model</strong>
          </div>
          <p class="relay-description">
            Monitoring events from all your write and read relays.
          </p>
        </div>
      </div>

      <div
        class="info-box info-box-clickable info-box-compact"
        on:click={showInboxScanner}
        on:keydown={(e) => e.key === "Enter" && showInboxScanner()}
        role="button"
        tabindex="0"
        title="View scanner"
      >
        <div class="relay-info">
          <div class="relay-header">
            <span class="scanner-icon">📡</span>
            <strong>Relay Scanner</strong>
          </div>
          <p class="relay-description relay-description-small">
            Scans other relays for events tagging you and broadcasts them to
            your inbox.
          </p>
        </div>
      </div>
      <div class="footer">
        <small>
          Made with 🐨 by
          <a
            href="https://njump.me/npub1v3tgrwwsv7c6xckyhm5dmluc05jxd4yeqhpxew87chn0kua0tjzqc6yvjh"
            target="_blank"
            rel="noopener noreferrer"
          >
            KoalaSat
          </a>
        </small>
      </div>
    {:else if currentView === "contacts"}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Contacts</h2>
        <button
          class="btn-back"
          on:click={() => window.open("https://following.space", "_blank")}
        >
          Follow packs
          <ExternalLink size={16} />
        </button>
      </div>
      <Contacts bind:this={contactsComponent} />
    {:else if currentView === "relays"}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Relays</h2>
        <div></div>
      </div>
      <Relays bind:this={relaysComponent} />
    {:else if currentView === "relayEvents"}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Outbox Model</h2>
        <button
          class="btn-back"
          on:click={() =>
            window.open(
              "https://www.whynostr.org/post/8yjqxm4sky-tauwjoflxs/",
              "_blank",
            )}
        >
          Info
          <ExternalLink size={16} />
        </button>
      </div>
      <RelayEvents bind:this={relayEventsComponent} />
    {:else if currentView === "inboxScanner"}
      <div class="nav-header">
        <button class="btn-back" on:click={showHome}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h2>Relay Scanner</h2>
        <div></div>
      </div>
      <InboxScanner />
    {/if}
  {/if}
</main>
