# Nostr Agenda - Browser Extension

A cross-browser extension skeleton compatible with both Firefox and Chrome, built with Svelte, TypeScript, and Vite.

## 🚀 Features

- ✅ **Cross-browser compatible** - Works on Chrome, Firefox, and other Chromium-based browsers
- ✅ **Modern stack** - Built with Svelte 5, TypeScript, and Vite
- ✅ **Manifest V3** - Uses the latest extension manifest version
- ✅ **Hot module reload** - Fast development with Vite
- ✅ **Type-safe messaging** - Strongly typed communication between extension components
- ✅ **Multiple entry points** - Popup, background service worker, and content scripts

## 📁 Project Structure

```
nostr-agenda/
├── public/
│   ├── manifest.json         # Extension manifest (MV3)
│   └── vite.svg              # Extension icon
├── src/
│   ├── background/
│   │   └── background.ts     # Background service worker
│   ├── content/
│   │   └── content.ts        # Content script (injected into pages)
│   ├── popup/
│   │   ├── App.svelte        # Popup UI component
│   │   ├── main.ts           # Popup entry point
│   │   └── popup.css         # Popup styles
│   ├── shared/
│   │   └── messaging.ts      # Shared messaging utilities & types
│   └── types/
│       └── chrome.d.ts       # Chrome API type definitions
├── popup.html                # Popup HTML (root level for Vite)
├── package.json
├── tsconfig.json
├── vite.config.ts            # Vite configuration for extension build
└── README.md
```

## 🛠️ Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
# Install dependencies
npm install
```

### Build for Development

```bash
# Build the extension
npm run build
```

The built extension will be in the `dist/` directory.

### Load Extension in Browser

#### Chrome / Edge / Brave

1. Open `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`)
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/` directory

#### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select the `manifest.json` file from the `dist/` directory

### Development Workflow

Since browser extensions don't support hot reload like regular web apps, you'll need to:

1. Make your changes in the source files
2. Run `npm run build` to rebuild
3. Click the reload button in your browser's extension page

## 🏗️ Architecture

### Components

#### 1. **Background Service Worker** (`src/background/background.ts`)
- Runs in the background
- Handles extension lifecycle events
- Manages storage and cross-component communication
- Listens for messages from popup and content scripts

#### 2. **Content Script** (`src/content/content.ts`)
- Injected into web pages
- Can access and modify the DOM
- Communicates with background and popup via messaging
- Example: Shows notifications on the page

#### 3. **Popup** (`src/popup/`)
- UI displayed when clicking the extension icon
- Built with Svelte for reactive components
- Communicates with background and content scripts
- Example features:
  - Ping background service worker
  - Ping content script
  - Get current page info
  - Send notifications to page

#### 4. **Shared Messaging** (`src/shared/messaging.ts`)
- Type-safe message passing system
- Defines message types and interfaces
- Utility functions for communication:
  - `sendToBackground()` - Send messages to background
  - `sendToTab()` - Send messages to specific tabs
  - `sendToActiveTab()` - Send messages to active tab

### Message Types

```typescript
enum MessageType {
  GET_DATA = 'GET_DATA',    // Request data
  SET_DATA = 'SET_DATA',    // Store data
  NOTIFY = 'NOTIFY',        // Send notification
  PING = 'PING',            // Test connection
}
```

## 📝 Customization

### Adding New Message Types

1. Add to `MessageType` enum in `src/shared/messaging.ts`
2. Handle in background listener (`src/background/background.ts`)
3. Handle in content listener (`src/content/content.ts`)
4. Use in popup (`src/popup/App.svelte`)

### Modifying Permissions

Edit `public/manifest.json`:

```json
{
  "permissions": [
    "storage",
    "activeTab",
    "tabs"  // Add more permissions
  ],
  "host_permissions": [
    "https://*/*"  // Modify host permissions
  ]
}
```

### Changing Content Script Injection

Edit `public/manifest.json`:

```json
{
  "content_scripts": [
    {
      "matches": ["https://example.com/*"],  // Specific sites
      "js": ["content.js"],
      "run_at": "document_idle"  // or document_start, document_end
    }
  ]
}
```

## 🔧 Build Configuration

The `vite.config.ts` is configured to:
- Build multiple entry points (popup, background, content)
- Place background and content scripts at root level
- Bundle all popup assets together
- Copy public files to dist

## 📦 Production Build

```bash
# Build for production
npm run build
```

The `dist/` folder will contain:
- `manifest.json` - Extension manifest
- `popup.html` - Popup page
- `background.js` - Background service worker
- `content.js` - Content script
- `assets/` - Bundled JS and CSS files

## 🐛 Debugging

### View Extension Logs

- **Background**: Right-click extension icon → "Inspect popup" → Console tab
- **Popup**: Right-click on popup → "Inspect"
- **Content Script**: Open DevTools on any page → Console tab

### Common Issues

1. **TypeScript errors about `chrome` API**: Make sure `@types/chrome` is installed
2. **Extension not loading**: Check manifest.json syntax
3. **Messages not received**: Verify message listeners are set up correctly
4. **Content script not injecting**: Check matches patterns in manifest.json

## 📚 Resources

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Firefox Extensions Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Svelte Documentation](https://svelte.dev/)
- [Vite Documentation](https://vitejs.dev/)

## 📄 License

MIT

## 🤝 Contributing

Feel free to submit issues and pull requests!
