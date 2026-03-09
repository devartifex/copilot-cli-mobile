# Azure & GitHub Setup Guide

This guide walks you through configuring GitHub OAuth and deploying Copilot CLI Mobile to Azure.

---

## Prerequisites

- A GitHub account with an active [Copilot license](https://github.com/features/copilot#pricing) (free tier works)
- *(For Azure deployment)* [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and authenticated (`az login`)
- *(For Azure deployment)* [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) (`azd`)

---

## 1. Register a GitHub OAuth App

The app uses [GitHub Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) — the same interactive flow used by `gh auth login`. This means:

- **No redirect URI required** — the server never receives a callback
- **No client secret required** — device flow only needs the `client_id`
- **Works for personal and work accounts** — each user logs in as themselves, giving Copilot access to their own repos and license
- **Supports GitHub org SSO** — logging in with a work account automatically includes SSO-authorized org repos

> **Why register an OAuth App at all?** GitHub requires a `client_id` to identify which application is initiating the device flow — without it, GitHub has no way to show the user which app is requesting access. It's the same reason `gh` ships with a built-in client ID. The registration is a one-time, ~30-second step that never needs to be repeated.

### Create the OAuth App

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: `Copilot CLI Mobile`
   - **Homepage URL**: any valid URL — e.g. `http://localhost:3000`
   - **Authorization callback URL**: same as above — device flow never redirects here
4. Click **Register application**
5. Copy the **Client ID** → `GITHUB_CLIENT_ID`
6. **Stop here** — do not generate a client secret

### Update for Production

After deploying, you can optionally update the **Homepage URL** to your production FQDN. Nothing else needs changing — no callback URL to update, ever.

---

## 2. Local Configuration

Create your `.env` file from the template:

```bash
cp .env.example .env
```

Fill in the two required values:

```env
GITHUB_CLIENT_ID=<from step 1>
SESSION_SECRET=<run: openssl rand -hex 32>
```

That's it — no client secret, no Azure AD credentials, no redirect URIs.

Start the dev server:

```bash
docker compose up --build
# or without Docker (requires Node 24+):
npm install && npm run build && npm start
```

---

## 3. Deploy to Azure with `azd`

### Install Azure Developer CLI

```bash
# macOS / Linux
curl -fsSL https://aka.ms/install-azd.sh | bash

# Windows
winget install Microsoft.Azd
```

### Configure and Deploy

```bash
# Authenticate
az login
azd auth login

# Set secrets in azd environment
azd env set GITHUB_CLIENT_ID <your-github-client-id>

# Provision Azure resources + build Docker image + deploy
azd up
```

`azd up` provisions:

| Resource | Purpose |
|----------|---------|
| **Container Registry** | Docker image storage |
| **Container App** | Serverless container runtime (port 3000, auto-TLS) |
| **Key Vault** | Stores `GITHUB_CLIENT_ID` and `SESSION_SECRET` (auto-generated) |
| **Managed Identity** | RBAC for ACR pull + Key Vault read (no stored credentials) |
| **Log Analytics + Application Insights** | Monitoring and diagnostics |

All secrets are stored in Key Vault and referenced by the Container App via managed identity — no plaintext secrets in the app configuration.

### Subsequent Deploys

```bash
azd deploy    # Redeploy without re-provisioning infrastructure
```

---

## 4. CI/CD with GitHub Actions

### Create a Service Principal

The deploy workflow needs Azure credentials. Create a service principal scoped to your resource group:

```bash
az ad sp create-for-rbac \
  --name "copilot-cli-mobile-cicd" \
  --role contributor \
  --scopes /subscriptions/<subscription-id>/resourceGroups/<resource-group> \
  --sdk-auth
```

### Add GitHub Repository Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|-------|
| `AZURE_CREDENTIALS` | Full JSON output from `az ad sp create-for-rbac` |
| `ACR_LOGIN_SERVER` | `<registry-name>.azurecr.io` |
| `ACR_NAME` | Container Registry name (without `.azurecr.io`) |
| `AZURE_RESOURCE_GROUP` | Resource Group name |

All four values are displayed in the `azd up` output.

### How It Works

- **CI** (`ci.yml`): Runs on every push — type-checks and builds the TypeScript
- **Deploy** (`deploy.yml`): Runs on push to `main`/`master` or manual trigger — builds Docker image, pushes to ACR, deploys to Container Apps, runs health check

---

## Troubleshooting

### "Device code expired"

The device code is valid for 15 minutes. If you see this error, refresh the page to start a new device flow.

### "Bad credentials" / GitHub token rejected

Your session's GitHub token may have been revoked. Log out and log in again to re-authorize via device flow.

### Container App not starting

Check the container logs:

```bash
az containerapp logs show \
  --name copilot-cli-mobile \
  --resource-group <resource-group> \
  --type console
```

Common issues:
- Missing `GITHUB_CLIENT_ID` or `SESSION_SECRET` — check Key Vault secrets
- Copilot CLI not installed — verify the Docker build completed successfully

### Cold Start Delays

Azure Container Apps with scale-to-zero may take 5–30 seconds to start after inactivity. This is expected behavior for the Consumption plan and a trade-off for near-zero cost.
