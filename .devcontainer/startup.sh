#!/usr/bin/env bash
set -e

# Generate .env with Codespace-aware defaults
ENV_FILE="$PWD/.env"

# GITHUB_CLIENT_ID comes from Codespace secrets (set at github.com/settings/codespaces)
if [[ -z "${GITHUB_CLIENT_ID:-}" ]]; then
  echo "⚠️  GITHUB_CLIENT_ID not set. Add it as a Codespace secret at github.com/settings/codespaces"
  exit 1
fi

# Generate SESSION_SECRET if not already set
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"

# Detect Codespace forwarded URL for BASE_URL
if [[ -n "${CODESPACE_NAME:-}" ]]; then
  BASE_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  BASE_URL="http://localhost:3000"
fi

cat > "$ENV_FILE" <<EOF
GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
SESSION_SECRET=${SESSION_SECRET}
BASE_URL=${BASE_URL}
NODE_ENV=development
EOF

echo "✅ .env written (BASE_URL=${BASE_URL})"

# Build and start
npm run build
npm start
