#!/bin/bash
set -e

echo "🔧 Starting WhatsApp Service..."
echo "Working directory: $(pwd)"

# Skip Chromium check in production - should be installed via POST_INSTALL_COMMANDS
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    echo "⚠️ WARNING: Chromium not found. WhatsApp may not work properly."
    echo "Please ensure chromium is installed via POST_INSTALL_COMMANDS in emergent.yml"
fi

# Clean up old Chrome locks and sessions
echo "🧹 Cleaning up old Chrome locks..."
find /app/whatsapp-service -name "SingletonLock" -delete 2>/dev/null || true
find /app/whatsapp-service -name "SingletonSocket" -delete 2>/dev/null || true
find /app/whatsapp-service -name "SingletonCookie" -delete 2>/dev/null || true

# Change to service directory
cd /app/whatsapp-service || exit 1

echo "🚀 Starting WhatsApp Service..."
exec node server.js
