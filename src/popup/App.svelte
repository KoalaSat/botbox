<script lang="ts">
  import { sendToBackground, sendToActiveTab, MessageType } from '../shared/messaging';
  
  let message = $state('');
  let response = $state('');
  let pageInfo = $state<{ title: string; url: string } | null>(null);
  let loading = $state(false);

  async function pingBackground() {
    loading = true;
    const result = await sendToBackground({ type: MessageType.PING });
    response = result.success ? `Background says: ${result.data}` : `Error: ${result.error}`;
    loading = false;
  }

  async function pingContentScript() {
    loading = true;
    const result = await sendToActiveTab({ type: MessageType.PING });
    if (result.success) {
      response = `Content script says: ${result.data}`;
    } else {
      response = `Error: ${result.error}. Note: Content scripts don't work on chrome://, edge://, or extension pages. Try a regular webpage.`;
    }
    loading = false;
  }

  async function getPageInfo() {
    loading = true;
    const result = await sendToActiveTab({ type: MessageType.GET_DATA });
    if (result.success) {
      pageInfo = result.data;
      response = 'Page info retrieved successfully';
    } else {
      response = `Error: ${result.error}. Try opening a regular webpage (e.g., https://example.com)`;
    }
    loading = false;
  }

  async function sendNotification() {
    if (!message.trim()) {
      response = 'Please enter a message';
      return;
    }
    
    loading = true;
    const result = await sendToActiveTab({ 
      type: MessageType.NOTIFY,
      payload: { message: message }
    });
    if (result.success) {
      response = 'Notification sent to page';
    } else {
      response = `Error: ${result.error}. Try opening a regular webpage (e.g., https://example.com)`;
    }
    loading = false;
  }
</script>

<main>
  <div class="container">
    <h1>Nostr Agenda</h1>
    <p class="subtitle">Browser Extension Demo</p>

    <div class="section">
      <h2>Test Communication</h2>
      
      <div class="button-group">
        <button onclick={pingBackground} disabled={loading}>
          Ping Background
        </button>
        
        <button onclick={pingContentScript} disabled={loading}>
          Ping Content Script
        </button>
        
        <button onclick={getPageInfo} disabled={loading}>
          Get Page Info
        </button>
      </div>

      {#if response}
        <div class="response">{response}</div>
      {/if}
    </div>

    {#if pageInfo}
      <div class="section">
        <h2>Current Page</h2>
        <div class="info-box">
          <p><strong>Title:</strong> {pageInfo.title}</p>
          <p><strong>URL:</strong> {pageInfo.url}</p>
        </div>
      </div>
    {/if}

    <div class="section">
      <h2>Send Notification to Page</h2>
      <input
        type="text"
        bind:value={message}
        placeholder="Enter message..."
        disabled={loading}
      />
      <button onclick={sendNotification} disabled={loading}>
        Send to Page
      </button>
    </div>
  </div>
</main>

<style>
  .container {
    padding: 20px;
    width: 400px;
  }

  h1 {
    margin: 0 0 5px 0;
    font-size: 24px;
    color: #646cff;
  }

  .subtitle {
    margin: 0 0 20px 0;
    font-size: 14px;
    color: #888;
  }

  .section {
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid #333;
  }

  .section:last-child {
    border-bottom: none;
  }

  h2 {
    margin: 0 0 12px 0;
    font-size: 16px;
    color: #888;
  }

  .button-group {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  button {
    flex: 1;
    min-width: 120px;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .response {
    padding: 12px;
    background-color: #1a1a1a;
    border-radius: 4px;
    font-size: 14px;
    word-break: break-word;
  }

  .info-box {
    background-color: #1a1a1a;
    padding: 12px;
    border-radius: 4px;
    font-size: 14px;
  }

  .info-box p {
    margin: 8px 0;
  }

  .info-box strong {
    color: #646cff;
  }

  input {
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 8px;
    border: 1px solid #333;
    border-radius: 4px;
    background-color: #1a1a1a;
    color: inherit;
    font-family: inherit;
    font-size: 14px;
    box-sizing: border-box;
  }

  input:focus {
    outline: none;
    border-color: #646cff;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: light) {
    .response,
    .info-box,
    input {
      background-color: #f5f5f5;
      border-color: #ddd;
    }
  }
</style>
