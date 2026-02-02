# ⚡ Nostr Contacts Manager

A browser extension for managing your Nostr contacts locally using NIP-02 and NIP-07.

## Features

- 🔐 **NIP-07 Authentication** - Login using browser extensions like Alby or nos2x
- 📇 **Contact Management** - View and manage your Nostr contact list (NIP-02)
- 👤 **Profile Display** - Fetch and display contact profiles with avatars and metadata
- 🔄 **Real-time Sync** - Synchronize with multiple Nostr relays
- 💾 **Local Database** - Store contacts and profiles locally for offline access
- ✏️ **Contact Removal** - Remove contacts and publish updated lists to relays
- 🌐 **Multi-relay Support** - Connect to common relays and user-specific relays (NIP-65)

## Architecture

### Core Components

1. **NIP-07 Service** (`src/services/nip07.ts`)
   - Interfaces with browser NIP-07 extensions
   - Handles authentication and event signing
   - No private key management (delegated to NIP-07 provider)

2. **Relay Manager** (`src/services/relayManager.ts`)
   - WebSocket connection management
   - Event fetching and publishing
   - Subscription handling
   - Default relays: wss://relay.damus.io, wss://relay.nostr.band, etc.

3. **Contacts Manager** (`src/services/contactsManager.ts`)
   - NIP-02 contact list operations
   - Parse and create kind 3 events
   - Add/remove contacts with relay publishing
   - NIP-65 user relay discovery

4. **Profile Manager** (`src/services/profileManager.ts`)
   - Fetch user profiles (kind 0 events)
   - Batch profile fetching for contacts
   - Profile caching in local database

5. **Database** (`src/services/db.ts`)
   - Local storage wrapper for Chrome extension
   - Stores user data, contacts, and profiles
   - Efficient contact lookup with profiles

## Installation

### Prerequisites

- Node.js 20.19+ or 22.12+ (we recommend using nvm)
- npm or yarn
- A NIP-07 compatible browser extension (Alby, nos2x, etc.)

### Development Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd nostr-agenda
```

2. Install Node.js 22 (if using nvm):
```bash
nvm install 22
nvm use 22
```

3. Install dependencies:
```bash
npm install
```

4. Build the extension:
```bash
npm run build
```

The built extension will be in the `dist/` directory.

### Load in Browser

#### Chrome/Edge/Brave

1. Open `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist/` directory from the project

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Navigate to `dist/` directory and select `manifest.json`

## Usage

### First Time Setup

1. **Install NIP-07 Extension**
   - Install [Alby](https://getalby.com/) or [nos2x](https://github.com/fiatjaf/nos2x) browser extension
   - Set up your Nostr account in the NIP-07 extension

2. **Login to Nostr Contacts Manager**
   - Click the extension icon in your browser toolbar
   - Click "Connect with NIP-07"
   - Approve the connection in your NIP-07 extension

3. **View Your Contacts**
   - The extension will automatically fetch your contact list from relays
   - Contact profiles will be loaded and displayed with avatars

### Managing Contacts

#### Remove a Contact

1. Click the "✕" button next to any contact
2. Confirm the removal
3. The extension will publish an updated contact list to your relays

#### Refresh Data

- Click the 🔄 button to fetch fresh data from relays
- This updates your profile and contact list

#### Logout

- Click the 🚪 button to logout
- This clears all local data

## Project Structure

```
nostr-agenda/
├── src/
│   ├── background/
│   │   └── background.ts         # Service worker handling Nostr operations
│   ├── content/
│   │   └── content.ts            # Content script (minimal)
│   ├── popup/
│   │   ├── App.svelte            # Main UI component
│   │   ├── main.ts               # Popup entry point
│   │   └── popup.css             # Styles
│   ├── services/
│   │   ├── nip07.ts              # NIP-07 authentication service
│   │   ├── relayManager.ts       # WebSocket relay connections
│   │   ├── contactsManager.ts    # NIP-02 contact operations
│   │   ├── profileManager.ts     # Profile fetching (kind 0)
│   │   └── db.ts                 # Local storage database
│   ├── shared/
│   │   └── messaging.ts          # Extension messaging utilities
│   └── types/
│       ├── nip07.d.ts            # NIP-07 type definitions
│       ├── nostr.d.ts            # Nostr data types
│       └── chrome.d.ts           # Chrome extension types
├── public/
│   └── manifest.json             # Extension manifest
├── dist/                         # Built extension (generated)
└── package.json
```

## NIPs Implemented

- **[NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)** - Basic protocol flow
- **[NIP-02](https://github.com/nostr-protocol/nips/blob/master/02.md)** - Contact List (kind 3)
- **[NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md)** - Browser extension for signing
- **[NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md)** - Relay List Metadata (kind 10002)

## Development

### Build for Development
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Type Checking
```bash
npm run check
```

## Technical Details

### How It Works

1. **Login Flow**
   - User clicks "Connect with NIP-07"
   - Extension requests public key from window.nostr
   - Fetches user's relay list (NIP-65) if available
   - Connects to relays and fetches contact list (kind 3)
   - Stores data locally in chrome.storage.local

2. **Contact List Sync**
   - Subscribes to kind 3 events from user's relays
   - Parses p-tags to extract contact pubkeys
   - Fetches profiles (kind 0) for all contacts
   - Caches everything locally for fast access

3. **Contact Removal**
   - Filters out the removed contact from local list
   - Creates new kind 3 event with updated tags
   - Signs event using NIP-07 (window.nostr.signEvent)
   - Publishes to all connected relays

### Default Relays

The extension connects to these relays by default:
- wss://relay.damus.io
- wss://relay.nostr.band
- wss://nos.lol
- wss://relay.snort.social

Additional relays are added from:
- User's NIP-07 relay configuration
- User's NIP-65 relay list (kind 10002)

## Security

- ✅ No private key management - uses NIP-07 for signing
- ✅ All data stored locally in browser
- ✅ WebSocket connections over WSS (secure)
- ✅ No external APIs or tracking
- ✅ Open source and auditable

## Troubleshooting

### "NIP-07 provider not found"
- Make sure Alby, nos2x, or another NIP-07 extension is installed
- Refresh the page and try again

### Contacts not loading
- Check browser console for errors
- Verify you have contacts in your Nostr account
- Try refreshing data with the 🔄 button

### Build errors
- Make sure you're using Node.js 20.19+ or 22.12+
- Delete `node_modules` and `package-lock.json`, then run `npm install`

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see LICENSE file for details

## Credits

Built with:
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) - Nostr protocol utilities
- [Svelte](https://svelte.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tool
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## Links

- [Nostr Protocol](https://github.com/nostr-protocol/nostr)
- [NIPs Repository](https://github.com/nostr-protocol/nips)
- [Alby Extension](https://getalby.com/)
- [nos2x Extension](https://github.com/fiatjaf/nos2x)
