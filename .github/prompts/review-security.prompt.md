---
description: 'Security-focused code review for public repo'
---

Review the code changes with a security focus. This is a PUBLIC repository.

## Check for:

### Secrets & Credentials
- No API keys, tokens, passwords, or secrets in code or comments
- No references to private repos, internal infrastructure, or deployment details
- No hardcoded URLs pointing to private/internal services

### Input Validation
- All user input validated and sanitized
- DOMPurify used for any HTML rendering
- Message length limits enforced (10K chars max)
- File upload limits enforced (10MB, 5 files, extension allowlist)

### SSRF Prevention
- All user-provided URLs validated against private IP blocklist
- HTTPS required for webhook/tool URLs
- No unvalidated redirects

### XSS Prevention
- No `innerHTML` without DOMPurify
- CSP headers maintained in hooks.server.ts
- Markdown rendering uses sanitized pipeline

### Session Security
- httpOnly, secure, sameSite cookies
- Token revalidation on WebSocket connect
- Session data not exposed to client

### WebSocket Security
- Message type whitelist enforced
- Origin validation
- Rate limiting active
