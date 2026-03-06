# Copilot CLI Web

> **Chat with GitHub Copilot from any browser** — a secure, self-hosted web app powered by the official [GitHub Copilot SDK](https://github.com/github/copilot-sdk).

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Azure_Container_Apps-Consumption-0078D4?logo=microsoftazure&logoColor=white" alt="Azure Container Apps">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License">
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| 🤖 **Copilot SDK** | Uses `@github/copilot-sdk` — the same engine behind GitHub Copilot CLI, accessed programmatically via JSON-RPC |
|  **Chat UI** | Clean, responsive, mobile-first interface with markdown rendering and syntax highlighting |
| ⚡ **Streaming** | Real-time token-by-token responses over WebSocket |
| 🔐 **Azure AD** | Enterprise-grade authentication via Microsoft Entra ID (OIDC + PKCE + refresh tokens) |
| 🐙 **GitHub OAuth** | Seamless integration with your GitHub Copilot license |
| 🏗️ **IaC** | One-command deployment with `azd up` — Bicep templates provision all Azure resources |
| 🔄 **CI/CD** | GitHub Actions workflows for continuous integration and deployment |
| 💰 **Scale-to-zero** | Azure Container Apps Consumption plan — near-zero cost when idle |

## Architecture

```
Browser (mobile / desktop)         Azure Container Apps
┌─────────────────────┐           ┌──────────────────────────┐
│                     │           │  Express + TypeScript    │
│  Chat UI (SPA)      │◄─WSS────►│                          │
│                     │           │  ┌── MSAL Node ────────┐ │
│  ┌─ Azure AD Login  │──OIDC───►│  │  Token cache         │ │
│  │                  │           │  │  Silent refresh      │ │
│  └─ GitHub OAuth    │──OAuth──►│  └──────────────────────┘ │
│                     │           │                          │
└─────────────────────┘           │  ┌── Copilot SDK ──────┐ │
                                  │  │  JSON-RPC (stdio)    │ │
                                  │  │  Copilot CLI server  │ │
                                  │  └──────────────────────┘ │
                                  └────────┬────────┬────────┘
                                           │        │
                              ┌────────────┘        └──────────────┐
                              ▼                                    ▼
                     Azure Key Vault                    Application Insights
                     (secrets via MI)                   + Log Analytics
```

### Azure Resources (provisioned by `azd up`)

| Resource | Purpose |
|----------|---------|
| **Container Registry** | Docker image store (no admin creds — RBAC only) |
| **Container App** | Runs the app with managed identity |
| **User-Assigned Managed Identity** | AcrPull + Key Vault Secrets User roles |
| **Key Vault** | Stores `AZURE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `SESSION_SECRET` |
| **Application Insights + Log Analytics** | Monitoring, logging, and diagnostics |

## Getting Started

### Prerequisites

- **Node.js 22+** — required by `@github/copilot-sdk`
- **GitHub account** with an active [Copilot license](https://github.com/features/copilot#pricing) (free tier works)
- **Azure subscription** — for deployment ([free account](https://azure.microsoft.com/free/))
- **Azure CLI** (`az`) — [install guide](https://docs.microsoft.com/cli/azure/install-azure-cli)
- **Azure Developer CLI** (`azd`) — [install guide](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) *(for deployment only)*

### 1. Clone and Install

```bash
git clone https://github.com/youruser/copilot-cli-web.git
cd copilot-cli-web
npm install
```

### 2. Configure Authentication

You need two registrations: one in Azure AD and one on GitHub.

#### Azure AD App Registration

> **Automated**: Run `./infra/scripts/setup-entra-app.sh http://localhost:3000` after `az login`.
>
> **Manual**: See [Azure Setup Guide](./docs/azure-setup.md#1-azure-ad-app-registration-microsoft-entra-id) for step-by-step portal instructions.

#### GitHub OAuth App — 30-second setup, no secret needed

The app uses [GitHub Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow) — the same flow as `gh auth login`. Users authenticate interactively from the app UI by entering a short code on GitHub. The OAuth App registration is only needed to obtain a `client_id`; **no client secret, no redirect URI, and no server-side GitHub credentials** are ever required.

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App** and fill in:
   - **Application name**: `Copilot CLI Web`
   - **Homepage URL**: any valid URL (e.g. `http://localhost:3000`)
   - **Authorization callback URL**: same as above — device flow never uses it
3. Click **Register application**
4. Copy the **Client ID** → `GITHUB_CLIENT_ID`
5. **Stop here** — no need to generate a client secret

> **Why register at all?** GitHub requires a `client_id` to identify which application is initiating the device flow. It's the same reason `gh` ships with a built-in client ID. The registration takes ~30 seconds and **never needs to be updated** when the app URL changes.

### 3. Set Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
AZURE_CLIENT_ID=<from-azure-app-registration>
AZURE_TENANT_ID=<from-azure-portal>
AZURE_CLIENT_SECRET=<from-azure-app-registration>
GITHUB_CLIENT_ID=<from-github-oauth-app>   # just the ID, no secret
SESSION_SECRET=<run: openssl rand -hex 32>
BASE_URL=http://localhost:3000
```

### 4. Run With Docker (Default)

```bash
npm run dev
```

This runs `docker compose up --build`.

To stop containers:

```bash
npm run dev:down
```

### 5. Run Directly On Host (Optional)

```bash
npm run dev:local
```

Open [http://localhost:3000](http://localhost:3000) — sign in with Microsoft, then connect GitHub by entering a short code at `github.com/login/device`. The chat is ready.

## Deployment

### One-Command Deploy with `azd`

```bash
# Login to Azure
az login
azd auth login

# Set your secrets (no GITHUB_CLIENT_SECRET — device flow doesn't need it)
azd env set AZURE_CLIENT_ID <value>
azd env set AZURE_TENANT_ID <value>
azd env set AZURE_CLIENT_SECRET <value>
azd env set GITHUB_CLIENT_ID <value>

# Provision infrastructure + build + deploy
azd up
```

This creates:
- **Azure Container Registry** (Basic, no admin credentials) — ~$5/month
- **User-Assigned Managed Identity** — RBAC for ACR pull + Key Vault secrets
- **Azure Key Vault** — stores all secrets securely (referenced via managed identity)
- **Application Insights + Log Analytics** — monitoring and diagnostics
- **Container Apps Environment** — managed Kubernetes
- **Container App** — your app, with health probes and auto-scaling

> **Important**: After deployment, update your Azure AD and GitHub OAuth redirect URIs to use the production URL (shown in `azd up` output).

### Docker (Local)

```bash
docker compose up --build
```

### CI/CD with GitHub Actions

Two workflows are included:

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Every push / PR | Type-check, lint, build |
| `deploy.yml` | Push to `main` | Build Docker image → push to ACR → deploy to Container Apps |

**Required GitHub Secrets:**

| Secret | How to get it |
|--------|--------------|
| `AZURE_CREDENTIALS` | `az ad sp create-for-rbac --sdk-auth --role contributor --scopes /subscriptions/<sub-id>` |
| `ACR_LOGIN_SERVER` | `<name>.azurecr.io` (from `azd up` output) |
| `ACR_NAME` | Container Registry name (from `azd up` output) |
| `AZURE_RESOURCE_GROUP` | Resource Group name (from `azd up` output) |

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AZURE_CLIENT_ID` | ✅ | — | Azure AD app registration client ID |
| `AZURE_TENANT_ID` | ✅ | — | Azure AD (Entra ID) tenant ID |
| `AZURE_CLIENT_SECRET` | ✅ | — | Azure AD app client secret |
| `GITHUB_CLIENT_ID` | ✅ | — | GitHub OAuth app client ID (no secret needed) |
| `SESSION_SECRET` | ✅ | — | Random string for session encryption (≥32 chars) |
| `BASE_URL` | ✅ | — | Full app URL (e.g., `http://localhost:3000`) |
| `PORT` | ❌ | `3000` | HTTP server port |
| `NODE_ENV` | ❌ | `development` | Set to `production` for secure cookies + trust proxy |

## Security

This app is designed with security as a first-class concern:

- **Full Copilot CLI parity** — all SDK built-in tools (GitHub API, file access, shell) are approved, matching the desktop Copilot CLI experience
- **Azure AD (OIDC + PKCE)** — enterprise-grade authentication with proof key for code exchange
- **Refresh tokens** — MSAL token cache enables automatic silent renewal (~90 day sessions with zero re-logins)
- **Server-side token storage** — the GitHub OAuth token is stored in the Express session and never sent to the browser
- **Security headers** — Helmet middleware sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Rate limiting** — per-IP request throttling to prevent abuse
- **Secure cookies** — `httpOnly`, `secure` (in production), `sameSite: lax`
- **CSRF protection** — `state` parameter validation on all OAuth callbacks

## Project Structure

```
copilot-cli-web/
├── src/
│   ├── index.ts                # Server entry point
│   ├── config.ts               # Environment variable validation
│   ├── server.ts               # Express app, middleware, static files
│   ├── auth/
│   │   ├── azure.ts            # Azure AD OIDC (MSAL + PKCE + refresh)
│   │   ├── github.ts           # GitHub OAuth flow
│   │   └── middleware.ts       # requireAuth / requireGitHubToken guards
│   ├── copilot/
│   │   ├── client.ts           # CopilotClient lifecycle management
│   │   └── session.ts          # Session creation, model listing
│   ├── routes/
│   │   ├── auth.ts             # /auth/* endpoints (login, callback, logout)
│   │   └── api.ts              # /api/* endpoints (models)
│   ├── ws/
│   │   └── handler.ts          # WebSocket: auth, message routing, streaming
│   └── types/
│       └── session.d.ts        # Express session type augmentation
├── public/
│   ├── index.html              # Single-page app shell
│   ├── css/style.css           # Dark theme, responsive layout
│   └── js/
│       ├── app.js              # App initialization and event wiring
│       ├── auth.js             # Auth status checking
│       └── chat.js             # Chat UI, WebSocket, markdown rendering
├── infra/
│   ├── main.bicep              # Bicep entry point
│   ├── main.parameters.json    # azd parameter bindings
│   ├── modules/
│   │   ├── container-apps.bicep    # Container Apps + environment
│   │   └── container-registry.bicep # Azure Container Registry
│   └── scripts/
│       └── setup-entra-app.sh  # Automated Azure AD app registration
├── .github/workflows/
│   ├── ci.yml                  # CI: type-check + build
│   └── deploy.yml              # CD: Docker → ACR → Container Apps
├── azure.yaml                  # azd project configuration
├── Dockerfile                  # Multi-stage build (Node 20 + Copilot CLI)
├── docker-compose.yml          # Local Docker development
├── package.json
└── tsconfig.json
```

## How It Works

1. **User opens the app** → redirected to Azure AD for Microsoft login
2. **After Azure AD login** → automatically redirected to GitHub OAuth to authorize Copilot access
3. **Tokens stored server-side** → Azure AD tokens in MSAL cache (auto-refresh), GitHub token in Express session
4. **Chat via WebSocket** → user sends a message, server forwards it to `@github/copilot-sdk`
5. **Streaming response** → SDK emits `assistant.message_delta` events, forwarded to the browser in real-time
6. **Subsequent visits** → `acquireTokenSilent` renews the Azure AD token without any redirect; GitHub token persists in session

## Cost Estimate

For single-user, intermittent usage:

| Resource | Monthly Cost |
|----------|-------------|
| Azure Container Apps (Consumption) | ~$0 (within free tier) |
| Azure Container Registry (Basic) | ~$5 |
| **Total** | **~$5/month** |

## License

MIT
