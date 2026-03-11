/**
 * Screenshot generation — run with:
 *   npx playwright test tests/screenshots.spec.ts --project=desktop
 *
 * Outputs to docs/screenshots/
 * Naming: usecase-{slug}-{viewport}.png
 *   e.g. usecase-code-mobile.png, usecase-code-ipad.png, usecase-code-desktop.png
 */

import { test, type Browser, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve('docs/screenshots');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

// ── Viewport definitions ──────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: 'mobile',   width: 390,  height: 844  },
  { name: 'ipad',     width: 768,  height: 1024 },
  { name: 'desktop',  width: 1280, height: 800  },
] as const;

type ViewportName = typeof VIEWPORTS[number]['name'];

// ── Shared model list ─────────────────────────────────────────────────────────

const MODELS = [
  { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: { supports: {} } },
  { id: 'o3', name: 'o3', vendor: 'OpenAI', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'o4', name: 'o4', vendor: 'OpenAI', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'o4-mini', name: 'o4-mini', vendor: 'OpenAI', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', vendor: 'Anthropic', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', vendor: 'Anthropic', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'claude-haiku-4-6', name: 'Claude Haiku 4.6', vendor: 'Anthropic', capabilities: { supports: {} } },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vendor: 'Google', capabilities: { supports: {} } },
];

// ── Auth mock helpers ─────────────────────────────────────────────────────────

async function openLogin(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  await page.route('**/auth/device/start', (r) =>
    r.fulfill({
      json: {
        user_code: 'B4F2-9AE1',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      },
    }),
  );
  await page.route('**/auth/device/poll', (r) =>
    r.fulfill({ json: { status: 'pending' } }),
  );

  await page.goto('/');
  await page.waitForSelector('.device-code-text', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  return { page, ctx };
}

// ── Login screens (all viewports) ────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test(`screenshot: login — ${vp.name}`, async ({ browser }) => {
    test.skip(!!process.env.CI, 'screenshot generation skipped in CI');
    const { page, ctx } = await openLogin(browser, vp);
    await page.screenshot({ path: `${OUT_DIR}/login-${vp.name}.png`, fullPage: false });
    await ctx.close();
  });
}

// ── Use-case screens ──────────────────────────────────────────────────────────

async function openChat(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  // Intercept SSR HTML: patch embedded SvelteKit data to set authenticated=true with user
  await page.route('/', async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    // Replace the embedded data payload in the SvelteKit script block
    html = html.replace(
      /data:\{authenticated:false,user:null\}/g,
      'data:{authenticated:true,user:{login:"devartifex",name:"Dev Artifex"}}',
    );
    // Also remove the login screen HTML so Svelte hydration matches
    await route.fulfill({ response, body: html });
  });

  // Mock __data.json for any client-side navigations
  await page.route('**/__data.json*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'data',
        nodes: [
          null,
          {
            type: 'data',
            data: [
              { authenticated: true, user: { login: 'devartifex', name: 'Dev Artifex' } },
              1,
            ],
          },
        ],
      }),
    }),
  );

  // Mock auth status endpoint
  await page.route('**/auth/status', (route) =>
    route.fulfill({ json: { authenticated: true, githubUser: 'devartifex' } }),
  );

  return { page, ctx };
}

// ── Use case 1: Code generation ───────────────────────────────────────────────
//   User asks for a TypeScript hook → gets a rich syntax-highlighted code response

for (const vp of VIEWPORTS) {
  test(`screenshot: use case — code generation (${vp.name})`, async ({ browser }) => {
    test.skip(!!process.env.CI, 'screenshot generation skipped in CI');

    const { page, ctx } = await openChat(browser, vp);

    await page.routeWebSocket('**/ws', (ws) => {
      ws.send(JSON.stringify({ type: 'connected', user: 'devartifex' }));

      ws.onMessage((data) => {
        const msg = JSON.parse(data as string);

        if (msg.type === 'list_models') {
          ws.send(JSON.stringify({ type: 'models', models: MODELS }));
        }

        if (msg.type === 'new_session') {
          ws.send(JSON.stringify({ type: 'session_created', model: 'claude-opus-4-6' }));
          ws.send(JSON.stringify({ type: 'title_changed', title: 'TypeScript useDebounce hook' }));
        }

        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'turn_start' }));
            ws.send(JSON.stringify({
              type: 'delta',
              content:
                "Here's a `useDebounce` hook in TypeScript:\n\n" +
                '```typescript\n' +
                "import { useState, useEffect } from 'react';\n\n" +
                'function useDebounce<T>(value: T, delay: number): T {\n' +
                '  const [debouncedValue, setDebouncedValue] = useState<T>(value);\n\n' +
                '  useEffect(() => {\n' +
                '    const timer = setTimeout(() => {\n' +
                '      setDebouncedValue(value);\n' +
                '    }, delay);\n' +
                '    return () => clearTimeout(timer);\n' +
                '  }, [value, delay]);\n\n' +
                '  return debouncedValue;\n' +
                '}\n\n' +
                'export default useDebounce;\n' +
                '```\n\n' +
                '**Usage example:**\n\n' +
                '```tsx\n' +
                'function SearchInput() {\n' +
                "  const [query, setQuery] = useState('');\n" +
                '  const debouncedQuery = useDebounce(query, 300);\n\n' +
                '  useEffect(() => {\n' +
                '    if (debouncedQuery) fetchResults(debouncedQuery);\n' +
                '  }, [debouncedQuery]);\n\n' +
                '  return <input onChange={(e) => setQuery(e.target.value)} />;\n' +
                '}\n' +
                '```\n\n' +
                'The cleanup function cancels the pending timer whenever `value` or `delay` changes, preventing stale calls.',
            }));
            ws.send(JSON.stringify({ type: 'turn_end' }));
            ws.send(JSON.stringify({ type: 'done' }));
            ws.send(JSON.stringify({ type: 'usage', inputTokens: 38, outputTokens: 204 }));
          }, 200);
        }
      });
    });

    await page.goto('/');
    await page.waitForSelector('.terminal', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('textarea:not([disabled])', { state: 'visible', timeout: 10000 });
    await page.fill('textarea', 'Write a TypeScript useDebounce hook for React');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.message.assistant', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/usecase-code-${vp.name}.png`, fullPage: false });
    await ctx.close();
  });
}

// ── Use case 2: Autopilot agent — plan panel + tool calls ─────────────────────
//   Agent plans, calls GitHub + filesystem tools, then opens a PR autonomously

for (const vp of VIEWPORTS) {
  test(`screenshot: use case — autopilot agent (${vp.name})`, async ({ browser }) => {
    test.skip(!!process.env.CI, 'screenshot generation skipped in CI');

    const { page, ctx } = await openChat(browser, vp);

    await page.routeWebSocket('**/ws', (ws) => {
      ws.send(JSON.stringify({ type: 'connected', user: 'devartifex' }));

      ws.onMessage((data) => {
        const msg = JSON.parse(data as string);

        if (msg.type === 'list_models') {
          ws.send(JSON.stringify({ type: 'models', models: MODELS }));
        }

        if (msg.type === 'new_session') {
          ws.send(JSON.stringify({ type: 'session_created', model: 'claude-opus-4-6' }));
          ws.send(JSON.stringify({ type: 'mode_changed', mode: 'autopilot' }));
          ws.send(JSON.stringify({ type: 'title_changed', title: 'Password reset — issue #88' }));
        }

        if (msg.type === 'message') {
          let t = 150;
          const tick = (msg: object, delay: number) => {
            t += delay;
            setTimeout(() => ws.send(JSON.stringify(msg)), t);
          };

          tick({ type: 'plan', exists: true, content:
            '## Password Reset — Issue #88\n\n' +
            '- [x] Read issue details from GitHub\n' +
            '- [x] Create `src/auth/reset-password.ts`\n' +
            '- [x] Add `/api/auth/reset` endpoint\n' +
            '- [x] Write `tests/reset-password.spec.ts`\n' +
            '- [ ] Open pull request',
          }, 0);

          tick({ type: 'turn_start' }, 80);
          tick({ type: 'tool_start', toolCallId: 'tc1', toolName: 'get_issue', mcpServerName: 'github' }, 20);
          tick({ type: 'tool_end', toolCallId: 'tc1' }, 350);
          tick({ type: 'tool_start', toolCallId: 'tc2', toolName: 'create_file', mcpServerName: 'filesystem' }, 30);
          tick({ type: 'tool_progress', toolCallId: 'tc2', message: 'Writing src/auth/reset-password.ts…' }, 200);
          tick({ type: 'tool_end', toolCallId: 'tc2' }, 400);
          tick({ type: 'tool_start', toolCallId: 'tc3', toolName: 'run_terminal', mcpServerName: 'shell' }, 30);
          tick({ type: 'tool_progress', toolCallId: 'tc3', message: 'npm test — 12 passed' }, 300);
          tick({ type: 'tool_end', toolCallId: 'tc3' }, 400);
          tick({ type: 'tool_start', toolCallId: 'tc4', toolName: 'create_pull_request', mcpServerName: 'github' }, 30);
          tick({ type: 'tool_end', toolCallId: 'tc4' }, 350);

          tick({
            type: 'delta',
            content:
              '✅ Done! Password reset flow is implemented and merged into a PR:\n\n' +
              '- **`src/auth/reset-password.ts`** — HMAC token generation, bcrypt hashing, 1-hour expiry\n' +
              '- **`/api/auth/reset`** — POST endpoint with rate limiting (5 req / 15 min per email)\n' +
              '- **`tests/reset-password.spec.ts`** — 12 passing tests covering happy path, expired tokens, and brute-force protection\n' +
              '- **[PR #91 opened](https://github.com/devartifex/app/pull/91)** — ready for review\n\n' +
              'All CI checks green. The plan file has been updated.',
          }, 100);
          tick({ type: 'turn_end' }, 50);
          tick({ type: 'done' }, 50);
          tick({ type: 'usage', inputTokens: 1820, outputTokens: 312 }, 50);
        }
      });
    });

    await page.goto('/');
    await page.waitForSelector('.terminal', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('textarea:not([disabled])', { state: 'visible', timeout: 10000 });
    await page.fill('textarea', 'Implement the password reset flow from issue #88, write the tests, open a PR');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.plan-panel', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('.message.assistant', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/usecase-autopilot-${vp.name}.png`, fullPage: false });
    await ctx.close();
  });
}

// ── Use case 3: Extended thinking with o3 ────────────────────────────────────
//   o3 emits a reasoning trace before answering a complex architecture question

for (const vp of VIEWPORTS) {
  test(`screenshot: use case — extended reasoning (${vp.name})`, async ({ browser }) => {
    test.skip(!!process.env.CI, 'screenshot generation skipped in CI');

    const { page, ctx } = await openChat(browser, vp);

    await page.routeWebSocket('**/ws', (ws) => {
      ws.send(JSON.stringify({ type: 'connected', user: 'devartifex' }));

      ws.onMessage((data) => {
        const msg = JSON.parse(data as string);

        if (msg.type === 'list_models') {
          ws.send(JSON.stringify({ type: 'models', models: MODELS }));
        }

        if (msg.type === 'new_session') {
          ws.send(JSON.stringify({ type: 'session_created', model: 'o3' }));
          ws.send(JSON.stringify({ type: 'model_changed', model: 'o3' }));
          ws.send(JSON.stringify({ type: 'title_changed', title: 'Distributed rate limiting at 1M req/s' }));
        }

        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'turn_start' }));

            // Stream reasoning chunks — do NOT send turn_end before screenshot;
            // finalizeStream() clears currentReasoningContent, so we must screenshot
            // while the turn is still in progress (streaming state).
            const thinkingChunks = [
              'The user wants a rate limiting design for 1M req/s. Let me think through the trade-offs carefully.\n\n',
              'Token bucket: maintains a counter per key that refills at a fixed rate. Allows bursting up to bucket capacity. At scale, sharing state requires a Redis INCR + TTL on every request — that\'s 1M Redis ops/s which is at or beyond practical limits (~500k–1M ops/s for a single Redis node).\n\n',
              'Sliding window (log): stores a sorted set of timestamps per key (ZADD/ZRANGEBYSCORE). Most accurate, but O(log n) per request and large memory footprint for high-traffic keys.\n\n',
              'Sliding window (count): approximate — divide window into sub-buckets and interpolate. Much cheaper: O(1) time, small memory.\n\n',
              'At 1M req/s I need to push state out of the hot path. Best approach: local in-process token buckets (sub-microsecond check) with async batched sync to Redis every 50–100ms. Accept ≈5% over-limit tolerance in exchange for near-zero latency overhead. Shard keys via consistent hashing across a Redis cluster.',
            ];

            let delay = 80;
            for (const chunk of thinkingChunks) {
              setTimeout(() => {
                ws.send(JSON.stringify({ type: 'reasoning_delta', content: chunk, reasoningId: 'r1' }));
              }, delay);
              delay += 200;
            }

            // Start streaming the answer — do NOT send turn_end yet so both
            // the reasoning block and streaming answer are visible simultaneously.
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'delta',
                content:
                  '## Distributed Rate Limiting at 1M req/s\n\n' +
                  '### Algorithm comparison\n\n' +
                  '| Approach | Accuracy | Burst | Redis cost |\n' +
                  '|---|---|---|---|\n' +
                  '| Fixed window | Low (2× burst at boundary) | Yes | O(1) INCR |\n' +
                  '| Token bucket | High | Configurable | O(1) but needs sync |\n' +
                  '| Sliding window (log) | Exact | No | O(log n) ZADD |\n' +
                  '| Sliding window (count) | ~99% | No | O(1) |\n\n' +
                  '### Recommended architecture\n\n' +
                  '**Local token buckets + async Redis sync**\n\n' +
                  '1. Each app node holds per-key token buckets in-process (hash map)\n' +
                  '2. Every 50–100 ms, flush deltas to Redis via `INCRBY` pipeline\n' +
                  '3. Redis cluster with consistent hashing — 6 nodes × 150k ops/s = 900k ops/s headroom\n' +
                  '4. Tolerate ±5% over-counting; exact limits rarely matter at this scale\n\n' +
                  '**Result:** hot-path latency drops from ~2 ms (Redis round-trip) to ~0.05 ms (in-process check).',
              }));
              // Don't send turn_end — screenshot while still streaming
            }, delay + 150);
          }, 200);
        }
      });
    });

    await page.goto('/');
    await page.waitForSelector('.terminal', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('textarea:not([disabled])', { state: 'visible', timeout: 10000 });
    await page.fill('textarea', 'Design a distributed rate limiting system for 1M req/s. Token bucket vs sliding window?');
    await page.keyboard.press('Enter');
    // Screenshot while streaming: reasoning block is visible alongside the streaming answer
    // (.message.assistant.streaming exists while turn_end hasn't been sent yet)
    await page.waitForSelector('.reasoning-block', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('.message.assistant.streaming', { state: 'visible', timeout: 20000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT_DIR}/usecase-reasoning-${vp.name}.png`, fullPage: false });
    await ctx.close();
  });
}
