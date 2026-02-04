# BotBox

![Title](assets/title.png)

A browser extension for managing your Nostr contacts locally using NIP-02 and NIP-07.

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

## Development

### Build

```bash
npm run build
```

### Prerequisites

- Node.js 20.19+ or 22.12+ (we recommend using nvm)
- npm or yarn
- A NIP-07 compatible browser extension (Alby, nos2x, etc.)

### Setup

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

### Contributing

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
