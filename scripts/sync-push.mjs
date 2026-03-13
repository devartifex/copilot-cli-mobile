#!/usr/bin/env node
/**
 * sync-push.mjs
 *
 * Pushes local Copilot CLI sessions to a remote copilot-unleashed instance.
 * Computes delta: only sends sessions that are new or updated since last sync.
 *
 * Usage:
 *   node scripts/sync-push.mjs                        # uses BASE_URL from .env
 *   node scripts/sync-push.mjs https://my-app.azurecontainerapps.io
 *
 * Requires:
 *   - GH_TOKEN or GITHUB_TOKEN env var (or gh auth token)
 *   - COPILOT_CONFIG_DIR or ~/.copilot with session-state/
 */

import { readFile, readdir, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const MAX_BATCH_SIZE = 20;
// Skip large files and binary-like files
const SKIP_FILES = new Set(['events.jsonl', 'session.db', 'session.db-shm', 'session.db-wal']);
const MAX_FILE_SIZE = 1024 * 1024; // 1MB per file

// Resolve configuration
const configDir = process.env.COPILOT_CONFIG_DIR?.replace(/^~/, homedir())
  ?? join(homedir(), '.copilot');
const sessionStateDir = join(configDir, 'session-state');

// Resolve remote URL
let baseUrl = process.argv[2]
  || process.env.BASE_URL
  || process.env.SYNC_REMOTE_URL
  || '';

if (!baseUrl) {
  // Try to read from .env
  try {
    const envContent = await readFile('.env', 'utf-8');
    const match = envContent.match(/^BASE_URL=(.+)$/m);
    if (match) baseUrl = match[1].trim();
  } catch {
    // No .env file
  }
}

if (!baseUrl) {
  console.error('Error: No remote URL specified.');
  console.error('Usage: node scripts/sync-push.mjs <remote-url>');
  console.error('  or set BASE_URL in .env or SYNC_REMOTE_URL env var');
  process.exit(1);
}

// Ensure no trailing slash
baseUrl = baseUrl.replace(/\/$/, '');

// Resolve GitHub token
const token = process.env.GH_TOKEN
  || process.env.GITHUB_TOKEN
  || (() => {
    try {
      return execSync('gh auth token', { encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  })();

if (!token) {
  console.error('Error: No GitHub token found.');
  console.error('Set GH_TOKEN or GITHUB_TOKEN, or authenticate with `gh auth login`.');
  process.exit(1);
}

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function readSessionFiles(sessionDir) {
  const files = {};

  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Skip rewind-snapshots (large, not needed)
        if (entry.name === 'rewind-snapshots') continue;
        await walk(join(dir, entry.name), relativePath);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) continue;

        try {
          const info = await stat(join(dir, entry.name));
          if (info.size > MAX_FILE_SIZE) continue;

          const content = await readFile(join(dir, entry.name), 'utf-8');
          files[relativePath] = content;
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(sessionDir);
  return files;
}

// Main
console.log(`Syncing sessions to ${baseUrl}`);
console.log(`Session source: ${sessionStateDir}`);

// 1. Get remote sessions
let remoteSessions;
try {
  const res = await fetch(`${baseUrl}/api/sessions/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to list remote sessions (${res.status}): ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  remoteSessions = new Map(data.sessions.map(s => [s.id, s.updatedAt]));
  console.log(`Remote has ${remoteSessions.size} sessions`);
} catch (err) {
  console.error(`Failed to connect to ${baseUrl}:`, err.message);
  process.exit(1);
}

// 2. Scan local sessions
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let localEntries;
try {
  localEntries = await readdir(sessionStateDir);
} catch {
  console.error(`No session-state directory at: ${sessionStateDir}`);
  process.exit(1);
}

const localSessions = [];
for (const entry of localEntries) {
  if (!UUID_RE.test(entry)) continue;

  const sessionDir = join(sessionStateDir, entry);
  const wsYaml = join(sessionDir, 'workspace.yaml');

  if (!await pathExists(wsYaml)) continue;

  // Read updated_at from workspace.yaml
  let updatedAt;
  try {
    const content = await readFile(wsYaml, 'utf-8');
    const match = content.match(/^updated_at:\s*(.+)$/m);
    if (match) updatedAt = match[1].trim();
  } catch {
    continue;
  }

  localSessions.push({ id: entry, updatedAt, dir: sessionDir });
}

console.log(`Local has ${localSessions.length} sessions`);

// 3. Compute delta
const toSync = localSessions.filter(local => {
  const remoteUpdated = remoteSessions.get(local.id);
  if (!remoteUpdated) return true; // New session
  if (!local.updatedAt) return false; // Can't compare
  // Sync if local is newer
  return new Date(local.updatedAt) > new Date(remoteUpdated);
});

if (toSync.length === 0) {
  console.log('✅ Already in sync — no new sessions to push');
  process.exit(0);
}

console.log(`${toSync.length} session(s) to sync`);

// 4. Push in batches
let totalCreated = 0;
let totalUpdated = 0;
let totalErrors = 0;

for (let i = 0; i < toSync.length; i += MAX_BATCH_SIZE) {
  const batch = toSync.slice(i, i + MAX_BATCH_SIZE);
  const batchNum = Math.floor(i / MAX_BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(toSync.length / MAX_BATCH_SIZE);

  console.log(`Pushing batch ${batchNum}/${totalBatches} (${batch.length} sessions)…`);

  const sessions = [];
  for (const s of batch) {
    const files = await readSessionFiles(s.dir);
    sessions.push({ id: s.id, files });
    process.stdout.write(`  📦 ${s.id.substring(0, 8)}… (${Object.keys(files).length} files)\n`);
  }

  try {
    const res = await fetch(`${baseUrl}/api/sessions/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessions }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`  ❌ Batch ${batchNum} failed (${res.status}): ${text}`);
      totalErrors += batch.length;
      continue;
    }

    const data = await res.json();
    totalCreated += data.summary.created;
    totalUpdated += data.summary.updated;
    totalErrors += data.summary.errors;

    for (const r of data.results) {
      if (r.status === 'error') {
        console.error(`  ❌ ${r.id}: ${r.error}`);
      }
    }
  } catch (err) {
    console.error(`  ❌ Batch ${batchNum} network error:`, err.message);
    totalErrors += batch.length;
  }
}

console.log('');
console.log(`✅ Sync complete: ${totalCreated} created, ${totalUpdated} updated, ${totalErrors} errors`);
