# Quick Setup Guide

## Prerequisites

- **Node.js 20.19+ or 22.12+** (Vite requires these versions)
- If using nvm: `nvm install 22 && nvm use 22`

## Installation

1. **Install dependencies**
   ```bash
   npm install
   ```

   This will install:
   - Svelte 5 and its Vite plugin
   - TypeScript
   - Chrome types for extension APIs
   - All other build dependencies

2. **Build the extension**
   ```bash
   npm run build
   ```

   The built extension will be in the `dist/` directory.

3. **Load in your browser**

   ### Chrome/Edge/Brave
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

   ### Firefox
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `dist/manifest.json`

## Development Tips

- After making changes, run `npm run build` again
- Click the reload button on your extension in the browser's extension page
- Open DevTools to see console logs from different parts:
  - **Background logs**: Right-click extension icon → Inspect
  - **Popup logs**: Right-click popup → Inspect
  - **Content logs**: Regular DevTools on any web page

## Testing the Extension

Once loaded, click the extension icon to open the popup. You can:

1. **Ping Background** - Test communication with the background service worker
2. **Ping Content Script** - Test communication with the content script on the active tab (requires a regular webpage like https://example.com)
3. **Get Page Info** - Retrieve title and URL from the current page
4. **Send Notification to Page** - Inject a notification into the current webpage

**Note**: Content script features (2-4) only work on regular web pages (http:// or https://), not on browser internal pages like chrome://, edge://, or extension pages. Navigate to any website before testing these features.

All communication uses the type-safe messaging system defined in `src/shared/messaging.ts`.

## Next Steps

- Customize the manifest in `public/manifest.json`
- Add your own message types in `src/shared/messaging.ts`
- Build your UI in `src/popup/App.svelte`
- Add background logic in `src/background/background.ts`
- Add page interaction in `src/content/content.ts`

Happy coding! 🚀
