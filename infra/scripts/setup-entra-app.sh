#!/usr/bin/env bash
# =============================================================================
# Setup Azure AD (Entra ID) App Registration for Copilot CLI Web
#
# Creates or updates an Azure AD App Registration with the correct redirect URIs
# and generates a client secret. Outputs all required environment variables.
#
# Usage:
#   ./setup-entra-app.sh <base-url>
#
# Examples:
#   ./setup-entra-app.sh http://localhost:3000
#   ./setup-entra-app.sh https://copilot-cli-web.kindocean-abc123.westeurope.azurecontainerapps.io
# =============================================================================
set -euo pipefail

BASE_URL="${1:?Usage: $0 <base-url>}"
APP_NAME="copilot-cli-web"

echo "🔍 Verifying Azure CLI authentication..."
ACCOUNT_NAME=$(az account show --query name -o tsv 2>/dev/null) || {
  echo "❌ Not logged in to Azure CLI. Run: az login"
  exit 1
}
echo "   Logged in to: ${ACCOUNT_NAME}"

echo ""
echo "═══════════════════════════════════════════"
echo "  Azure AD App Registration"
echo "═══════════════════════════════════════════"
echo ""

# Check if app registration already exists
EXISTING_APP=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")

if [ -n "$EXISTING_APP" ]; then
  echo "✅ App registration already exists: $EXISTING_APP"
  APP_ID="$EXISTING_APP"
else
  echo "📝 Creating app registration: $APP_NAME"
  APP_ID=$(az ad app create \
    --display-name "$APP_NAME" \
    --sign-in-audience "AzureADMyOrg" \
    --web-redirect-uris "${BASE_URL}/auth/callback" \
    --query appId -o tsv)
  echo "✅ Created app registration: $APP_ID"
fi

# Retrieve tenant ID from the current subscription
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "   Tenant ID: $TENANT_ID"

# Ensure redirect URI is up to date
echo "📝 Updating redirect URIs..."
az ad app update \
  --id "$APP_ID" \
  --web-redirect-uris "${BASE_URL}/auth/callback" \
  --web-home-page-url "$BASE_URL" 2>/dev/null || true

# Generate a new client secret (rotates existing secret)
echo "🔑 Generating client secret..."
SECRET_RESULT=$(az ad app credential reset \
  --id "$APP_ID" \
  --display-name "copilot-cli-web-secret" \
  --years 2 \
  --query password -o tsv)
echo "✅ Client secret created (save it now — it will not be displayed again)"

echo ""
echo "═══════════════════════════════════════════"
echo "  GitHub OAuth App (Manual Step)"
echo "═══════════════════════════════════════════"
echo ""
echo "⚠️  GitHub OAuth Apps cannot be created via API."
echo "   Create one at: https://github.com/settings/developers"
echo ""
echo "   Use these settings:"
echo "   ┌──────────────────────────────┬──────────────────────────────────────────┐"
echo "   │ Application name             │ Copilot CLI Web                          │"
echo "   │ Homepage URL                 │ ${BASE_URL}$(printf '%*s' $((40 - ${#BASE_URL})) '')│"
echo "   │ Authorization callback URL   │ ${BASE_URL}/auth/github/callback$(printf '%*s' $((20 - ${#BASE_URL})) '')│"
echo "   └──────────────────────────────┴──────────────────────────────────────────┘"
echo ""

echo "═══════════════════════════════════════════"
echo "  Environment Variables"
echo "═══════════════════════════════════════════"
echo ""
echo "Add to your .env file:"
echo ""
echo "  AZURE_CLIENT_ID=${APP_ID}"
echo "  AZURE_TENANT_ID=${TENANT_ID}"
echo "  AZURE_CLIENT_SECRET=${SECRET_RESULT}"
echo "  GITHUB_CLIENT_ID=<from GitHub OAuth App>"
echo "  GITHUB_CLIENT_SECRET=<from GitHub OAuth App>"
echo "  SESSION_SECRET=$(openssl rand -hex 32)"
echo "  BASE_URL=${BASE_URL}"
echo ""
echo "Or set via azd for Azure deployment:"
echo ""
echo "  azd env set AZURE_CLIENT_ID ${APP_ID}"
echo "  azd env set AZURE_TENANT_ID ${TENANT_ID}"
echo "  azd env set AZURE_CLIENT_SECRET ${SECRET_RESULT}"
echo "  azd env set GITHUB_CLIENT_ID <from GitHub OAuth App>"
echo "  azd env set GITHUB_CLIENT_SECRET <from GitHub OAuth App>"
echo ""
echo "✅ Done! Create the GitHub OAuth App (if not already done), then run 'azd up'."
