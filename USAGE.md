# Usage Guide - BotBox

## Quick Start

### 1. Prerequisites

Before using the extension, you need:

- **A NIP-07 compatible browser extension** installed:
  - [Alby](https://getalby.com/) - Recommended, full-featured Bitcoin & Nostr wallet
  - [nos2x](https://github.com/fiatjaf/nos2x) - Simple Nostr signer
  - [Flamingo](https://www.flamingo.me/) - Another option
  
- **A Nostr account** set up in your NIP-07 extension with:
  - Your public/private key pair
  - At least one relay configured
  - Ideally, some contacts already added

### 2. Installation

1. **Build the extension** (if not already done):
   ```bash
   npm run build
   ```

2. **Load in Chrome/Edge/Brave**:
   - Open `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `dist/` directory

3. **Load in Firefox**:
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select `dist/manifest.json`

### 3. First Login

1. Click the extension icon (⚡) in your browser toolbar
2. You'll see the login screen
3. Click **"Connect with NIP-07"**
4. Your NIP-07 extension will prompt you to authorize
5. Click "Authorize" or "Allow"

The extension will now:
- Fetch your profile
- Fetch your contact list (kind 3 event)
- Fetch profiles for all your contacts
- Store everything locally

**Note**: Initial sync may take 5-15 seconds depending on:
- Number of contacts
- Relay response times
- Your connection speed

## Features

### View Your Profile

At the top of the popup, you'll see:
- Your profile picture (if set)
- Your display name or username
- Your public key (truncated)
- Number of contacts
- Number of relays connected

### Browse Contacts

The contacts list shows:
- **Profile picture** - Avatar image (or placeholder if not set)
- **Name** - Display name, username, petname, or "Anonymous"
- **Public key** - Truncated hex pubkey for identification
- **About** - Bio/description (first 100 characters)

### Remove a Contact

1. Find the contact you want to remove
2. Click the **✕** button on the right side
3. Confirm the action in the popup dialog
4. The extension will:
   - Remove the contact from your local list
   - Create a new kind 3 event without this contact
   - Sign the event using your NIP-07 extension
   - Publish to all connected relays

**Important**: This publishes a new contact list to Nostr. All your other apps will see the change.

### Refresh Data

Click the **🔄** button to:
- Fetch latest profile updates
- Sync contact list from relays
- Update all contact profiles
- Refresh relay connections

Use this when:
- You've added contacts in another app
- You want to see latest profile changes
- Relays seem out of sync

### Logout

Click the **🚪** button to:
- Clear all local data
- Disconnect from relays
- Return to login screen

You'll need to reconnect with NIP-07 to use the extension again.

## Understanding the Data

### What Gets Stored Locally?

The extension stores in `chrome.storage.local`:

1. **User Data** (`nostr_user_data`):
   - Your public key
   - Your profile (name, picture, about, etc.)
   - List of contacts (pubkeys, relay hints, petnames)
   - Connected relays
   - Last update timestamp

2. **Contact Profiles** (`nostr_contact_profiles`):
   - Profile data for each contact
   - Cached to avoid repeated relay queries

### What Gets Published to Relays?

When you remove a contact:

1. **Kind 3 Event** (Contact List):
   ```json
   {
     "kind": 3,
     "tags": [
       ["p", "pubkey1", "wss://relay.example.com", "Alice"],
       ["p", "pubkey2", "", "Bob"],
       ...
     ],
     "content": ""
   }
   ```

The event contains:
- `p` tags for each remaining contact
- Optional relay hint (3rd element)
- Optional petname (4th element)

## Troubleshooting

### "NIP-07 provider not found"

**Problem**: Extension can't find window.nostr

**Solutions**:
1. Install a NIP-07 extension (Alby, nos2x, etc.)
2. Refresh the page after installing
3. Make sure the NIP-07 extension is enabled
4. Try a different NIP-07 provider

### Contacts Not Loading

**Problem**: Login succeeds but contacts don't appear

**Solutions**:
1. Wait 10-15 seconds for relay responses
2. Click the refresh button (🔄)
3. Check if you have contacts in your Nostr account
4. Open browser console (F12) and check for errors
5. Try different relays in your NIP-07 extension

### Slow Performance

**Problem**: Extension is slow to load data

**Solutions**:
1. Reduce number of contacts (if you have many)
2. Use faster/closer relays
3. Clear local data and re-sync (logout and login)
4. Check your internet connection

### Contact Removal Not Working

**Problem**: Removed contact still appears

**Solutions**:
1. Check if NIP-07 signing was successful
2. Wait for relay propagation (may take a few seconds)
3. Click refresh (🔄) to sync
4. Check browser console for errors
5. Verify relays are accepting events

### Extension Icon Not Appearing

**Problem**: Can't find extension in toolbar

**Solutions**:
1. Check chrome://extensions/ to verify it's loaded
2. Pin the extension to toolbar:
   - Click puzzle icon in Chrome toolbar
   - Find "BotBox"
   - Click pin icon

## Advanced Usage

### Using Custom Relays

The extension will use relays from:

1. **Your NIP-07 extension** - Primary source
2. **Your NIP-65 relay list** - Fetched automatically (kind 10002)
3. **Default relays** - Fallback if no relays configured:
   - wss://relay.damus.io
   - wss://relay.nostr.band
   - wss://nos.lol
   - wss://relay.snort.social

To use specific relays:
1. Configure them in your NIP-07 extension (Alby settings)
2. Or publish a NIP-65 relay list event from another client

### Privacy Considerations

- **No key management**: Your private key never leaves your NIP-07 extension
- **Local storage**: All data stored in browser's local storage
- **No tracking**: No analytics or external API calls
- **Open source**: Code is auditable

### Data Export

Your data is in `chrome.storage.local`. To export:

1. Open browser console (F12)
2. Run:
   ```javascript
   chrome.storage.local.get(null, (data) => console.log(JSON.stringify(data, null, 2)))
   ```
3. Copy the output

### Integration with Other Apps

This extension works alongside:
- **Nostr clients** (Damus, Amethyst, Snort, etc.)
- **Other NIP-07 extensions** (use one at a time)
- **Nostr web apps** (they share the same NIP-07 provider)

Changes you make here will reflect in other apps, and vice versa.

## Best Practices

1. **Regular Backups**: Keep backups of your NIP-07 keys
2. **Test First**: Try removing one contact before bulk operations
3. **Monitor Relays**: Use reliable, responsive relays
4. **Update Regularly**: Keep the extension and NIP-07 provider updated
5. **Check Permissions**: Only grant necessary permissions

## Getting Help

- Check the [README.md](README.md) for technical details
- Review browser console for error messages
- Open an issue on GitHub
- Ask in Nostr communities

## Keyboard Shortcuts

Currently, there are no keyboard shortcuts, but they could be added in future versions.

## Future Features (Roadmap)

Potential additions:
- Add new contacts
- Edit petnames
- Filter/search contacts
- Export/import contact lists
- Contact statistics
- Relay health monitoring
- Dark mode

## Security Notes

⚠️ **Important**:
- Never share your private key
- Only use trusted NIP-07 extensions
- Review what you're signing in NIP-07 prompts
- This extension only requests signing for contact list updates
- All operations are transparent and logged to console

## Feedback

Your feedback helps improve the extension! Please report:
- Bugs and issues
- Feature requests
- Performance problems
- UX improvements
- Documentation errors
