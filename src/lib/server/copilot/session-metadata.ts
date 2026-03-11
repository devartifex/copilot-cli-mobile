import { readFile, readdir, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../config.js';

export interface CheckpointEntry {
  number: number;
  title: string;
  filename: string;
}

export interface SessionDetail {
  id: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  checkpoints: CheckpointEntry[];
  plan?: string;
  isRemote?: boolean;
}

/** Resolve the session-state root directory */
function getSessionStateDir(): string {
  const base = config.copilotConfigDir || join(homedir(), '.copilot');
  return join(base, 'session-state');
}

/** Check if a path exists */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Count checkpoint files (excluding index.md) in a session directory */
export async function countCheckpoints(sessionDir: string): Promise<number> {
  const checkpointsDir = join(sessionDir, 'checkpoints');
  try {
    const entries = await readdir(checkpointsDir);
    return entries.filter((f) => f.endsWith('.md') && f !== 'index.md').length;
  } catch {
    return 0;
  }
}

/** Check if a plan.md exists in a session directory */
export async function hasPlan(sessionDir: string): Promise<boolean> {
  return pathExists(join(sessionDir, 'plan.md'));
}

/** Parse checkpoints/index.md to extract the checkpoint list */
export async function parseCheckpointIndex(sessionDir: string): Promise<CheckpointEntry[]> {
  const indexPath = join(sessionDir, 'checkpoints', 'index.md');
  try {
    const content = await readFile(indexPath, 'utf-8');
    const entries: CheckpointEntry[] = [];

    // Parse markdown table rows: | # | Title | File |
    for (const line of content.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (match) {
        entries.push({
          number: parseInt(match[1], 10),
          title: match[2].trim(),
          filename: match[3].trim(),
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Read plan.md content from a session directory */
async function readPlanContent(sessionDir: string): Promise<string | undefined> {
  const planPath = join(sessionDir, 'plan.md');
  try {
    return await readFile(planPath, 'utf-8');
  } catch {
    return undefined;
  }
}

/** Enrich a session summary with filesystem metadata (checkpoints, plan) */
export async function enrichSessionMetadata(
  sessionId: string,
  context?: { cwd?: string; gitRoot?: string; repository?: string; branch?: string },
  isRemote?: boolean,
): Promise<{ checkpointCount: number; hasPlan: boolean; cwd?: string; repository?: string; branch?: string; isRemote?: boolean }> {
  const sessionDir = join(getSessionStateDir(), sessionId);

  const [checkpointCount, planExists] = await Promise.all([
    countCheckpoints(sessionDir),
    hasPlan(sessionDir),
  ]);

  return {
    checkpointCount,
    hasPlan: planExists,
    cwd: context?.cwd,
    repository: context?.repository,
    branch: context?.branch,
    isRemote,
  };
}

/** Get full session detail for the preview panel */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const sessionDir = join(getSessionStateDir(), sessionId);
  if (!await pathExists(sessionDir)) return null;

  const [checkpoints, planContent] = await Promise.all([
    parseCheckpointIndex(sessionDir),
    readPlanContent(sessionDir),
  ]);

  // Read workspace.yaml for metadata
  let metadata: Record<string, string | undefined> = {};
  try {
    const yamlContent = await readFile(join(sessionDir, 'workspace.yaml'), 'utf-8');
    metadata = parseWorkspaceYaml(yamlContent);
  } catch {
    // workspace.yaml may not exist for all sessions
  }

  return {
    id: sessionId,
    cwd: metadata.cwd,
    repository: metadata.repository,
    branch: metadata.branch,
    summary: metadata.summary,
    createdAt: metadata.created_at,
    updatedAt: metadata.updated_at,
    checkpoints,
    plan: planContent,
    isRemote: metadata.is_remote === 'true',
  };
}

/** Simple YAML parser for workspace.yaml (avoids external dependency) */
function parseWorkspaceYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = '';
  let multilineValue = '';
  let inMultiline = false;

  for (const line of content.split('\n')) {
    if (inMultiline) {
      // Multiline values (YAML block scalars) are indented
      if (line.startsWith('  ') || line === '') {
        multilineValue += (multilineValue ? '\n' : '') + line.replace(/^  /, '');
        continue;
      }
      // End of multiline
      result[currentKey] = multilineValue.trim();
      inMultiline = false;
      multilineValue = '';
    }

    const match = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (value === '|-' || value === '|' || value === '>-' || value === '>') {
      // Start of multiline block
      currentKey = key;
      inMultiline = true;
      multilineValue = '';
    } else {
      result[key] = value;
    }
  }

  // Handle trailing multiline
  if (inMultiline && currentKey) {
    result[currentKey] = multilineValue.trim();
  }

  return result;
}

/** Lightweight session summary returned by the filesystem scanner */
export interface FilesystemSession {
  id: string;
  title?: string;
  updatedAt?: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  checkpointCount: number;
  hasPlan: boolean;
}

/**
 * Scan the session-state directory on disk and return session summaries built
 * from workspace.yaml metadata. This is the fallback when the SDK returns
 * nothing (e.g. bundled sessions copied into a fresh container).
 */
export async function listSessionsFromFilesystem(): Promise<FilesystemSession[]> {
  const stateDir = getSessionStateDir();

  let entries: string[];
  try {
    entries = await readdir(stateDir);
  } catch {
    return [];
  }

  // UUID pattern — only pick directories that look like session IDs
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const results = await Promise.all(
    entries
      .filter((name) => uuidRe.test(name))
      .map(async (sessionId): Promise<FilesystemSession | null> => {
        const sessionDir = join(stateDir, sessionId);

        try {
          const info = await stat(sessionDir);
          if (!info.isDirectory()) return null;
        } catch {
          return null;
        }

        let metadata: Record<string, string> = {};
        try {
          const yamlContent = await readFile(join(sessionDir, 'workspace.yaml'), 'utf-8');
          metadata = parseWorkspaceYaml(yamlContent);
        } catch {
          // No workspace.yaml — skip this directory
          return null;
        }

        const [checkpointCount, planExists] = await Promise.all([
          countCheckpoints(sessionDir),
          hasPlan(sessionDir),
        ]);

        return {
          id: sessionId,
          title: metadata.summary || undefined,
          updatedAt: metadata.updated_at || metadata.created_at,
          cwd: metadata.cwd,
          repository: metadata.repository,
          branch: metadata.branch,
          checkpointCount,
          hasPlan: planExists,
        };
      }),
  );

  return results.filter((s): s is FilesystemSession => s !== null);
}
