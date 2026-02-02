# Extension Fixes - NIP-07 Integration

## Problem Summary
The extension was failing to connect with NIP-07 because `window.nostr` is not available in browser extension contexts (popup, background service worker). This is a fundamental limitation of how browser extensions work.

## Solution Implemented
We implemented a **tab injection approach** where the extension injects code into the active webpage to access `window.nostr`. This is the standard approach used by browser extensions that need to interact with NIP-07 providers.

## Changes Made

### 1. Created New NIP-07 Tab Service (`src/services/nip07Tab.ts`)
- Injects code into the active tab using `chrome.scripting.executeScript`
- Executes code in the `MAIN` world where `window.nostr` is available
- Provides methods to:
  - Check if NIP-07 provider is available
  - Get public key from the provider
  - Sign events
  - Get user's relays
  - Wait for provider to be ready

### 2. Updated Background Script (`src/background/background.ts`)
- Added new `CONNECT_NIP07` message type
- Created `handleConnectNip07()` function that uses the tab injection service
- This function is called when the user clicks "Connect with NIP-07"
- Fetches pubkey and relays from the active tab's `window.nostr`

### 3. Updated Popup (`src/popup/App.svelte`)
- Removed auto-login check on mount (which was failing)
- Changed login flow to explicitly request connection via background script
- Two-step process:
  1. Connect to NIP-07 (via `CONNECT_NIP07` message)
  2. Login with retrieved credentials (via `NIP07_LOGIN` message)

### 4. Updated Messaging Types (`src/shared/messaging.ts`)
- Added `CONNECT_NIP07` message type to the enum

### 5. Updated Manifest Permissions (`public/manifest.json`)
- Already had `scripting` permission which is required for tab injection
- Already had `activeTab` permission for accessing the current tab

## How to Test

### Prerequisites
1. Install a NIP-07 compatible extension:
   - [Alby](https://getalby.com/) (recommended)
   - [nos2x](https://github.com/fiatjaf/nos2x)
   - Or any other NIP-07 provider

2. Build the extension (if not already done):
   ```bash
   source ~/.nvm/nvm.sh
   nvm use 20
   npm run build
   ```

### Testing Steps

1. **Load the Extension in Chrome/Brave/Edge:**
   - Open `chrome://extensions/` (or `brave://extensions/`, `edge://extensions/`)
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder from this project

2. **Navigate to a Regular Webpage:**
   - Open a new tab
   - Go to any HTTP/HTTPS website (e.g., `https://example.com`)
   - **Important:** The extension needs to inject code into a webpage, so internal browser pages like `chrome://extensions/` won't work

3. **Connect with NIP-07:**
   - Click the extension icon in the browser toolbar
   - Click "Connect with NIP-07"
   - Your NIP-07 provider (e.g., Alby) should ask for permission
   - Grant permission to the extension

4. **Verify Connection:**
   - After connecting, you should see your profile information
   - The extension will fetch your contacts from Nostr relays
   - You should see a list of your contacts (if you have any)

5. **Test Contact Management:**
   - Click the "🔄" button to refresh contacts from relays
   - Click the "✕" button on a contact to remove them
   - The extension will publish a new contact list to your relays

6. **Test Logout:**
   - Click the "🚪" button to logout
   - All local data will be cleared
   - You'll need to reconnect with NIP-07

## Troubleshooting

### Error: "NIP-07 provider not found"
- Make sure you have a NIP-07 extension installed (Alby, nos2x, etc.)
- Make sure you're on a regular webpage (http:// or https://)
- Try refreshing the webpage and clicking the extension icon again

### Error: "No active tab found"
- Make sure you have at least one regular webpage open
- Don't try to use the extension on browser internal pages

### Extension doesn't appear in toolbar
- Make sure the extension is enabled in `chrome://extensions/`
- Try reloading the extension
- Try restarting the browser

### Contacts not loading
- Make sure you're connected to the internet
- Make sure your NIP-07 provider has relays configured
- Try clicking the refresh button (🔄)
- Check the browser console for errors (F12 → Console tab)

## Technical Details

### Why Tab Injection?
Browser extensions have three main contexts:
1. **Popup**: Where the UI runs (can't access `window.nostr`)
2. **Background**: Service worker for background tasks (can't access `window.nostr`)
3. **Content Scripts**: Run in webpage context but isolated (can't access `window.nostr`)

To access `window.nostr` (which is injected by NIP-07 extensions into webpages), we need to:
1. Use `chrome.scripting.executeScript` with `world: 'MAIN'`
2. This executes code in the same context as the webpage
3. From there, we can access `window.nostr` and communicate back to the extension

### Security Considerations
- The extension only injects code when explicitly requested by the user
- All NIP-07 operations require user approval from their NIP-07 provider
- The extension never stores private keys
- All signing is done through the user's NIP-07 provider

## Future Improvements
- Add support for adding new contacts
- Add search/filter functionality for contacts
- Add more detailed profile information
- Add relay health monitoring
- Add notifications for new contacts
- Add backup/export functionality
