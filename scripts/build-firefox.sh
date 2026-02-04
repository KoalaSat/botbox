#!/bin/bash

echo "Building Firefox extension..."

# Build using Firefox-specific config
vite build --config vite.config.firefox.ts

# Replace manifest.json with Firefox manifest
cp public/manifest-firefox.json dist-firefox/manifest.json

echo "Firefox build complete in dist-firefox/"

# Create .xpi package inside dist-firefox
echo "Creating .xpi package..."
cd dist-firefox
zip -r botbox-firefox.xpi *
cd ..

echo "✅ Firefox extension built successfully!"
echo "   - Directory: dist-firefox/"
echo "   - Package: dist-firefox/botbox-firefox.xpi"
