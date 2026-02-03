<script lang="ts">
  import { onMount } from "svelte";
  import { Database } from "../services/db";
  import { Zap, Check, X, Loader } from "lucide-svelte";

  let relayUrl = "";
  let isLoading = false;
  let isTesting = false;
  let error = "";
  let success = "";
  let testResult: { success: boolean; message: string } | null = null;

  onMount(async () => {
    await loadRelayUrl();
  });

  async function loadRelayUrl() {
    const url = await Database.getConsistencyRelayUrl();
    if (url) {
      relayUrl = url;
    }
  }

  function validateRelayUrl(url: string): { valid: boolean; error?: string } {
    if (!url.trim()) {
      return { valid: false, error: "Relay URL is required" };
    }

    // Check if it's a valid WebSocket URL
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      return { valid: false, error: "URL must start with ws:// or wss://" };
    }

    try {
      new URL(url);
      return { valid: true };
    } catch {
      return { valid: false, error: "Invalid URL format" };
    }
  }

  async function testConnection() {
    const validation = validateRelayUrl(relayUrl);
    if (!validation.valid) {
      testResult = {
        success: false,
        message: validation.error || "Invalid URL",
      };
      return;
    }

    isTesting = true;
    testResult = null;
    error = "";

    try {
      const ws = new WebSocket(relayUrl);

      const timeout = setTimeout(() => {
        ws.close();
        testResult = { success: false, message: "Connection timeout" };
        isTesting = false;
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        testResult = { success: true, message: "Connection successful!" };
        ws.close();
        isTesting = false;
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        testResult = { success: false, message: "Failed to connect to relay" };
        isTesting = false;
      };
    } catch (err) {
      testResult = { success: false, message: "Connection failed" };
      isTesting = false;
    }
  }

  async function saveRelayUrl() {
    const validation = validateRelayUrl(relayUrl);
    if (!validation.valid) {
      error = validation.error || "Invalid URL";
      return;
    }

    isLoading = true;
    error = "";
    success = "";

    try {
      await Database.setConsistencyRelayUrl(relayUrl.trim());
      success = "Consistency relay configured successfully!";

      // Clear success message after 3 seconds
      setTimeout(() => {
        success = "";
      }, 3000);
    } catch (err) {
      console.error("Error saving relay URL:", err);
      error = err instanceof Error ? err.message : "Failed to save relay URL";
    } finally {
      isLoading = false;
    }
  }

  async function clearRelay() {
    if (
      !confirm("Are you sure you want to remove the consistency relay configuration?")
    ) {
      return;
    }

    isLoading = true;
    error = "";

    try {
      await Database.clearConsistencyRelayUrl();
      relayUrl = "";
      success = "Consistency relay configuration cleared";
      testResult = null;

      setTimeout(() => {
        success = "";
      }, 3000);
    } catch (err) {
      console.error("Error clearing relay URL:", err);
      error = "Failed to clear relay URL";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="page-view">
  <div class="page-container">
    {#if error}
      <div class="error">
        {error}
        <button on:click={() => (error = "")}><X size={18} /></button>
      </div>
    {/if}

    {#if success}
      <div class="success-banner">
        <Check size={16} />
        {success}
      </div>
    {/if}

    <div class="form-container">
      <h3>Consistency Relay Configuration</h3>

      <p class="form-help">
        Configure a relay to store and view events from your extension. This can
        be a local relay or any public Nostr relay.
      </p>

      <div class="form-group">
        <label for="relay-url">Relay URL</label>
        <input
          id="relay-url"
          class="form-input"
          type="text"
          bind:value={relayUrl}
          placeholder="wss://..."
          disabled={isLoading}
        />
      </div>

      {#if testResult}
        <div
          class="test-result {testResult.success
            ? 'test-success'
            : 'test-error'}"
        >
          {#if testResult.success}
            <Check size={16} />
          {:else}
            <X size={16} />
          {/if}
          {testResult.message}
        </div>
      {/if}

      <div class="form-actions">
        <button
          class="btn-secondary"
          on:click={testConnection}
          disabled={isLoading || isTesting || !relayUrl.trim()}
        >
          {#if isTesting}
            <Loader size={16} class="spin" />
            Testing...
          {:else}
            Test Connection
          {/if}
        </button>

        <button
          class="btn-primary"
          on:click={saveRelayUrl}
          disabled={isLoading || !relayUrl.trim()}
        >
          {#if isLoading}
            <Loader size={16} class="spin" />
          {:else}
            <Check size={16} />
          {/if}
          Save Relay
        </button>
        {#if relayUrl}
          <button class="btn-remove" on:click={clearRelay} disabled={isLoading}>
            <X size={16} />
            Clear Configuration
          </button>
        {/if}
      </div>
    </div>

    <div class="info-box-help">
      <h4>💡 Tips</h4>
      <ul>
        <li>Use <code>ws://</code> if running a local relay server</li>
        <li>Use <code>wss://</code> for secure connections to public relays</li>
        <li>Test the connection before saving to ensure it's working</li>
        <li>You can change this relay at any time</li>
      </ul>
    </div>
  </div>
</div>
