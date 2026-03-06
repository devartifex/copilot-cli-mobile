# Azure & GitHub OAuth Setup Guide

This guide walks you through manually configuring Azure AD (Microsoft Entra ID) and GitHub OAuth for Copilot CLI Web. If you prefer automation, run the setup script instead:

```bash
az login
./infra/scripts/setup-entra-app.sh http://localhost:3000
```

---

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) installed and authenticated (`az login`)
- A GitHub account with an active [Copilot license](https://github.com/features/copilot#pricing)
- *(Optional)* [Azure Developer CLI](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) for `azd up` deployment

---

## 1. Azure AD App Registration (Microsoft Entra ID)

### Create the App Registration

1. Navigate to [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Fill in:
   - **Name**: `copilot-cli-web`
   - **Supported account types**: *Accounts in this organizational directory only* (single tenant)
   - **Redirect URI**: Platform = `Web`, URI = `http://localhost:3000/auth/callback`
4. Click **Register**
5. Note the following values from the **Overview** page:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`

### Create a Client Secret

1. In the app registration page, go to **Certificates & secrets**
2. Click **New client secret**
3. Set:
   - **Description**: `copilot-cli-web`
   - **Expires**: 24 months
4. Click **Add**
5. **Copy the secret Value immediately** (it won't be shown again) → `AZURE_CLIENT_SECRET`

### Add Production Redirect URI

After deploying to Azure, return to the app registration and add a second redirect URI:

- Platform: `Web`
- URI: `https://<your-container-app-fqdn>/auth/callback`

---

## 2. GitHub OAuth App — Device Flow

The app uses [GitHub Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) — the same interactive flow used by `gh auth login`. This means:

- **No redirect URI required** — the server never needs to receive a callback
- **No client secret required** — device flow only needs the client ID
- **Works for personal and work accounts** — each user logs in as themselves, giving Copilot access to their own repos and license
- **Supports GitHub org SSO** — logging in with a work account automatically includes SSO-authorized org repos

### Create the OAuth App

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: `Copilot CLI Web`
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000` (device flow does not use this — any valid URL is fine)
4. Click **Register application**
5. Note the **Client ID** → `GITHUB_CLIENT_ID`

> ✅ **No client secret needed.** GitHub device flow only requires the client ID. Do not generate one.

### Update for Production

After deploying, update only the **Homepage URL** field:

- **Homepage URL**: `https://<your-container-app-fqdn>`

The callback URL is irrelevant for device flow, so no update is needed there.

---

## 3. Local Configuration

Create your `.env` file from the template:

```bash
cp .env.example .env
```

Fill in the values:

```env
AZURE_CLIENT_ID=<from step 1>
AZURE_TENANT_ID=<from step 1>
AZURE_CLIENT_SECRET=<from step 1>
GITHUB_CLIENT_ID=<from step 2>
SESSION_SECRET=<run: openssl rand -hex 32>
BASE_URL=http://localhost:3000
```

> No `GITHUB_CLIENT_SECRET` — device flow only needs the client ID.

Start the dev server:

```bash
npm run dev
```

---

## 4. Deploy to Azure with `azd`

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
azd env set AZURE_CLIENT_ID <value>
azd env set AZURE_TENANT_ID <value>
azd env set AZURE_CLIENT_SECRET <value>
azd env set GITHUB_CLIENT_ID <value>
# No GITHUB_CLIENT_SECRET — device flow doesn't need it

# Provision Azure resources + build Docker image + deploy
azd up
```

After `azd up` completes, note the Container App FQDN from the output and update:
1. **Azure AD** redirect URI (see [Add Production Redirect URI](#add-production-redirect-uri))
2. **GitHub OAuth** callback URL (see [Update for Production](#update-for-production))

### Subsequent Deploys

```bash
azd deploy    # Redeploy without re-provisioning
```

---

## 5. CI/CD with GitHub Actions

### Create a Service Principal

The deploy workflow needs Azure credentials. Create a service principal scoped to your resource group:

```bash
az ad sp create-for-rbac \
  --name "copilot-cli-web-cicd" \
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
| `ACR_NAME` | Container Registry name |
| `AZURE_RESOURCE_GROUP` | Resource Group name |

All four values are displayed in the `azd up` output.

---

## Troubleshooting

### "AADSTS50011: The redirect URI does not match"

Your Azure AD app registration's redirect URI doesn't match the `BASE_URL`. Verify:
- The redirect URI in Azure Portal matches `{BASE_URL}/auth/callback` exactly
- The protocol matches (`http` vs `https`)

### "Device code expired"

The device code is valid for 15 minutes. If you see this error, refresh the page to start a new device flow.

### "Bad credentials" / GitHub token rejected

Your session's GitHub token may have been revoked. Log out and log in again to re-authorize via device flow.

### Cold Start Delays

Azure Container Apps with scale-to-zero may take 5–30 seconds to start after inactivity. This is expected behavior for the Consumption plan and a trade-off for near-zero cost.
