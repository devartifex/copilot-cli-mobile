# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix & disclosure**: coordinated with reporter

## Security Architecture

This application follows security best practices:

- **Authentication**: GitHub Device Flow OAuth (no client secret stored)
- **Session security**: httpOnly, secure (prod), sameSite cookies with server-side session storage
- **Session fixation**: `session.regenerate()` after successful GitHub auth
- **Token handling**: GitHub tokens stored server-side only, never sent to browser
- **Token freshness**: tokens expire after 7 days (configurable); re-auth required
- **Token revalidation**: WebSocket connections validate GitHub token against GitHub's API on connect (catches revoked tokens)
- **XSS prevention**: DOMPurify sanitizes all dynamic content; CSP restricts script sources
- **Subresource Integrity**: All CDN scripts use SRI hashes
- **Rate limiting**: 200 requests per 15 minutes per IP
- **WebSocket**: Origin validation, session-based auth, message type whitelist, 10K char limit
- **Infrastructure**: Managed identity for registry pull, HTTPS-only ingress, secrets stored natively in Container Apps (encrypted at rest)

## Self-Hosting Security Checklist

If you deploy your own instance:

1. **Create your own GitHub OAuth App** — never share `GITHUB_CLIENT_ID`
2. **Generate a strong `SESSION_SECRET`** — at least 32 random characters
3. **Set `NODE_ENV=production`** — enables secure cookies and trust proxy
4. **Set `BASE_URL`** — must match your actual deployment URL for origin validation
5. **Restrict access** (recommended) — set `ALLOWED_GITHUB_USERS=user1,user2` to limit who can log in
6. **Review token lifetime** — default is 7 days; customize with `TOKEN_MAX_AGE_MS`
7. **Enable HTTPS** — required in production (Azure Container Apps provides this automatically)
8. **Monitor logs** — security events are logged as structured JSON to stdout
9. **Set IP restrictions** (optional) — use `ipRestrictions` Bicep param to lock ACA ingress to known IPs
