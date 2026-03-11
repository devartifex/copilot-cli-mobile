#!/usr/bin/env node
/**
 * bundle-sessions.mjs
 *
 * Copies ~/.copilot/session-state/ into ./bundled-sessions/ so it gets
 * included in the Docker build context. The Dockerfile then copies it into
 * the image under /home/node/.copilot/session-state/.
 *
 * This creates a point-in-time snapshot of your local CLI sessions so they
 * are visible in the deployed container. Sessions added after the build will
 * not appear until you rebuild.
 *
 * Usage:
 *   node scripts/bundle-sessions.mjs           # uses ~/.copilot
 *   COPILOT_CONFIG_DIR=/path/to/copilot node scripts/bundle-sessions.mjs
 */

import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const configDir = process.env.COPILOT_CONFIG_DIR?.replace(/^~/, homedir())
  ?? join(homedir(), '.copilot');

const sourceDir = join(configDir, 'session-state');
const destDir = new URL('../bundled-sessions', import.meta.url).pathname;

if (!existsSync(sourceDir)) {
  console.error(`No session-state directory found at: ${sourceDir}`);
  console.error('Set COPILOT_CONFIG_DIR to point at your Copilot config directory.');
  process.exit(1);
}

// Clean and recreate destination
await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });

const sessions = await readdir(sourceDir);
console.log(`Bundling ${sessions.length} sessions from ${sourceDir}…`);

// Copy each session directory — skip events.jsonl (can be huge, not needed for listing)
let copied = 0;
for (const sessionId of sessions) {
  const src = join(sourceDir, sessionId);
  const dst = join(destDir, sessionId);
  try {
    await cp(src, dst, {
      recursive: true,
      filter: (src) => !src.endsWith('events.jsonl'),
    });
    copied++;
  } catch {
    // Skip unreadable entries
  }
}

console.log(`✓ Bundled ${copied} sessions to ./bundled-sessions/`);
console.log('  Run `npm run build` or `azd deploy` to include them in the container.');
