<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sendToBackground } from '../shared/messaging';
  import { MessageType } from '../shared/messaging';
  import { RefreshCw, Square } from 'lucide-svelte';

  interface ScannerStatus {
    isScanning: boolean;
    lastScanTime: number | null;
    totalEventsDiscovered: number;
    totalEventsBroadcast: number;
  }

  let status: ScannerStatus | null = null;
  let isLoading = false;
  let isScanning = false;
  let isStopping = false;
  let pollInterval: number | null = null;

  onMount(() => {
    fetchStatus();
    // Start polling every 500ms to catch live updates during scanning
    pollInterval = window.setInterval(() => {
      fetchStatus();
    }, 500);
  });

  onDestroy(() => {
    if (pollInterval !== null) {
      clearInterval(pollInterval);
    }
  });

  export async function fetchStatus() {
    isLoading = true;
    try {
      const response = await sendToBackground({
        type: MessageType.GET_INBOX_SCANNER_STATUS,
      });

      if (response.success) {
        status = response.data;
      }
    } catch (err) {
      console.error('Error fetching scanner status:', err);
    } finally {
      isLoading = false;
    }
  }

  async function triggerScan() {
    isScanning = true;
    try {
      const response = await sendToBackground({
        type: MessageType.TRIGGER_INBOX_SCAN,
      });

      if (response.success) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Error triggering scan:', err);
    } finally {
      isScanning = false;
    }
  }

  async function stopScan() {
    isStopping = true;
    try {
      const response = await sendToBackground({
        type: MessageType.STOP_INBOX_SCAN,
      });

      if (response.success) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Error stopping scan:', err);
    } finally {
      isStopping = false;
    }
  }

  function formatTime(timestamp: number | null): string {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  }
</script>

<div class="inbox-scanner">
  {#if status}
    <div class="scanner-status">
      <div class="status-row">
        <div class="status-item">
          <div class="status-label">Last Scan</div>
          <div class="status-value-small">{formatTime(status.lastScanTime)}</div>
        </div>
        <div class="status-item">
          <div class="status-label">Status</div>
          <div class="status-value">
            {#if status.isScanning}
              <span class="badge badge-scanning">Scanning...</span>
            {:else}
              <span class="badge badge-ready">Ready</span>
            {/if}
          </div>
        </div>
      </div>

      <div class="status-row">
        <div class="status-item">
          <div class="status-label">Events Discovered</div>
          <div class="status-value">{status.totalEventsDiscovered}</div>
        </div>
        <div class="status-item">
          <div class="status-label">Events Broadcasted</div>
          <div class="status-value">{status.totalEventsBroadcast}</div>
        </div>
      </div>

      <div class="scanner-actions">
        {#if status.isScanning}
          <button 
            class="btn btn-stop" 
            on:click={stopScan} 
            disabled={isStopping}
          >
            <Square size={16} />
            {isStopping ? 'Stopping...' : 'Stop Scan'}
          </button>
        {:else}
          <button 
            class="btn btn-scan" 
            on:click={triggerScan} 
            disabled={isScanning}
          >
            {#if isScanning}
              <RefreshCw size={16} class="spin" />
            {:else}
              <RefreshCw size={16} />
            {/if}
            Scan & Broadcast Now
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .inbox-scanner {
    padding: 1rem;
  }

  .scanner-status {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .status-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .status-row:last-child {
    margin-bottom: 0;
  }

  .status-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .status-label {
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .status-value {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .status-value-small {
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-scanning {
    background: var(--primary-color);
    color: white;
  }

  .badge-ready {
    background: var(--success-bg);
    color: var(--success-text);
  }

  .scanner-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-scan {
    background: var(--primary-color);
    color: white;
  }

  .btn-scan:hover:not(:disabled) {
    background: var(--primary-hover);
  }

  .btn-stop {
    background: var(--danger-color, #dc3545);
    color: white;
  }

  .btn-stop:hover:not(:disabled) {
    background: var(--danger-hover, #c82333);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
