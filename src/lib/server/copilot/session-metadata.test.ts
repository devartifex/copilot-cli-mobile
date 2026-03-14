import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const {
  accessMock,
  readFileMock,
  readdirMock,
  rmMock,
  statMock,
} = vi.hoisted(() => ({
  accessMock: vi.fn(),
  readFileMock: vi.fn(),
  readdirMock: vi.fn(),
  rmMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: accessMock,
  readFile: readFileMock,
  readdir: readdirMock,
  rm: rmMock,
  stat: statMock,
  default: {
    access: accessMock,
    readFile: readFileMock,
    readdir: readdirMock,
    rm: rmMock,
    stat: statMock,
  },
}));

vi.mock('../config.js', () => ({
  config: {
    copilotConfigDir: '/mock-copilot',
  },
}));

import {
  buildSessionContext,
  countCheckpoints,
  deleteSessionFromFilesystem,
  getSessionDetail,
  getSessionStateDir,
  isValidSessionId,
  listSessionsFromFilesystem,
} from './session-metadata.js';

const stateDir = '/mock-copilot/session-state';
const sessionId = '11111111-1111-1111-1111-111111111111';
const sessionDir = join(stateDir, sessionId);
const secondSessionId = '22222222-2222-2222-2222-222222222222';
const secondSessionDir = join(stateDir, secondSessionId);

function directoryStat(): { isDirectory: () => boolean } {
  return { isDirectory: () => true };
}

beforeEach(() => {
  accessMock.mockReset();
  readFileMock.mockReset();
  readdirMock.mockReset();
  rmMock.mockReset();
  statMock.mockReset();

  accessMock.mockResolvedValue(undefined);
  rmMock.mockResolvedValue(undefined);
  statMock.mockResolvedValue(directoryStat());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session metadata helpers', () => {
  it('resolves the session-state directory from the Copilot config path', () => {
    expect(getSessionStateDir()).toBe(stateDir);
  });

  it('counts checkpoint markdown files and ignores index.md', async () => {
    readdirMock.mockResolvedValue(['1.md', '2.md', 'index.md', 'notes.txt']);

    await expect(countCheckpoints(sessionDir)).resolves.toBe(2);
    expect(readdirMock).toHaveBeenCalledWith(join(sessionDir, 'checkpoints'));
  });

  it('returns zero checkpoints when the directory is unreadable', async () => {
    readdirMock.mockRejectedValue(new Error('EACCES'));

    await expect(countCheckpoints(sessionDir)).resolves.toBe(0);
  });
});

describe('getSessionDetail', () => {
  it('returns null when the session directory does not exist', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'));

    await expect(getSessionDetail(sessionId)).resolves.toBeNull();
  });

  it('parses workspace metadata, checkpoint index, and plan content', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'workspace.yaml')) {
        return [
          'cwd: /repo',
          'repository: owner/repo',
          'branch: main',
          'summary: |-',
          '  First line',
          '  Second line',
          'created_at: 2024-01-01T00:00:00Z',
          'updated_at: 2024-01-02T00:00:00Z',
          'is_remote: true',
        ].join('\n');
      }

      if (path === join(sessionDir, 'checkpoints', 'index.md')) {
        return [
          '| # | Title | File |',
          '| - | ----- | ---- |',
          '| 1 | Start | 001-start.md |',
          '| 2 | Finish | 002-finish.md |',
        ].join('\n');
      }

      if (path === join(sessionDir, 'plan.md')) {
        return 'Ship the feature';
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    const detail = await getSessionDetail(sessionId);

    expect(detail).toEqual({
      id: sessionId,
      cwd: '/repo',
      repository: 'owner/repo',
      branch: 'main',
      summary: 'First line\nSecond line',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      checkpoints: [
        { number: 1, title: 'Start', filename: '001-start.md' },
        { number: 2, title: 'Finish', filename: '002-finish.md' },
      ],
      plan: 'Ship the feature',
      isRemote: true,
    });
  });

  it('handles malformed workspace.yaml without throwing', async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'workspace.yaml')) return 'summary\n  bad-data';
      if (path === join(sessionDir, 'checkpoints', 'index.md')) return 'not a table';
      if (path === join(sessionDir, 'plan.md')) throw new Error('ENOENT');
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(getSessionDetail(sessionId)).resolves.toEqual({
      id: sessionId,
      cwd: undefined,
      repository: undefined,
      branch: undefined,
      summary: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      checkpoints: [],
      plan: undefined,
      isRemote: false,
    });
  });
});

describe('listSessionsFromFilesystem', () => {
  it('lists filesystem sessions from UUID directories with parsed metadata', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === stateDir) {
        return [sessionId, 'not-a-session', secondSessionId];
      }
      if (path === join(sessionDir, 'checkpoints')) {
        return ['1.md', 'index.md'];
      }
      if (path === join(secondSessionDir, 'checkpoints')) {
        return ['1.md', '2.md', 'index.md'];
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    accessMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'plan.md')) return undefined;
      if (path === join(secondSessionDir, 'plan.md')) throw new Error('ENOENT');
      return undefined;
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'workspace.yaml')) {
        return ['summary: Session one', 'updated_at: 2024-01-05T00:00:00Z', 'cwd: /repo-one'].join('\n');
      }
      if (path === join(secondSessionDir, 'workspace.yaml')) {
        return ['summary: Session two', 'created_at: 2024-01-03T00:00:00Z', 'branch: dev'].join('\n');
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const sessions = await listSessionsFromFilesystem();

    expect(sessions).toEqual([
      {
        id: sessionId,
        title: 'Session one',
        updatedAt: '2024-01-05T00:00:00Z',
        cwd: '/repo-one',
        repository: undefined,
        branch: undefined,
        checkpointCount: 1,
        hasPlan: true,
      },
      {
        id: secondSessionId,
        title: 'Session two',
        updatedAt: '2024-01-03T00:00:00Z',
        cwd: undefined,
        repository: undefined,
        branch: 'dev',
        checkpointCount: 2,
        hasPlan: false,
      },
    ]);
  });

  it('returns an empty list when the session-state directory is missing', async () => {
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    await expect(listSessionsFromFilesystem()).resolves.toEqual([]);
  });

  it('skips entries that fail stat or workspace reads', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === stateDir) return [sessionId, secondSessionId];
      if (path === join(secondSessionDir, 'checkpoints')) return ['index.md'];
      throw new Error(`Unexpected path: ${path}`);
    });

    statMock.mockImplementation(async (path: string) => {
      if (path === sessionDir) throw new Error('EACCES');
      return directoryStat();
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (path === join(secondSessionDir, 'workspace.yaml')) throw new Error('EACCES');
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(listSessionsFromFilesystem()).resolves.toEqual([]);
  });
});

describe('buildSessionContext', () => {
  it('builds context from workspace metadata, plan, and the last three checkpoints', async () => {
    readdirMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'checkpoints')) {
        return ['001.md', '002.md', '003.md', '004.md', 'index.md'];
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (path === join(sessionDir, 'workspace.yaml')) {
        return ['summary: Prior summary', 'repository: owner/repo', 'branch: feature'].join('\n');
      }
      if (path === join(sessionDir, 'plan.md')) {
        return 'Resume from plan';
      }
      if (path === join(sessionDir, 'checkpoints', '002.md')) return 'Checkpoint two';
      if (path === join(sessionDir, 'checkpoints', '003.md')) return 'Checkpoint three';
      if (path === join(sessionDir, 'checkpoints', '004.md')) return 'Checkpoint four';
      throw new Error(`Unexpected path: ${path}`);
    });

    const context = await buildSessionContext(sessionId);

    expect(context).toContain('## Previous Session Summary\nPrior summary');
    expect(context).toContain('Repository: owner/repo (branch: feature)');
    expect(context).toContain('## Previous Plan\nResume from plan');
    expect(context).not.toContain('Checkpoint: 001.md');
    expect(context).toContain('## Checkpoint: 002.md\nCheckpoint two');
    expect(context).toContain('## Checkpoint: 003.md\nCheckpoint three');
    expect(context).toContain('## Checkpoint: 004.md\nCheckpoint four');
  });

  it('returns null when no usable context files can be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    await expect(buildSessionContext(sessionId)).resolves.toBeNull();
  });
});

describe('deleteSessionFromFilesystem', () => {
  it('rejects invalid session IDs', async () => {
    await expect(deleteSessionFromFilesystem('not-a-uuid')).resolves.toBe(false);
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('returns false when the session directory is missing', async () => {
    accessMock.mockRejectedValue(new Error('ENOENT'));

    await expect(deleteSessionFromFilesystem(sessionId)).resolves.toBe(false);
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('removes valid session directories from disk', async () => {
    await expect(deleteSessionFromFilesystem(sessionId)).resolves.toBe(true);
    expect(rmMock).toHaveBeenCalledWith(sessionDir, { recursive: true, force: true });
  });
});

describe('isValidSessionId', () => {
  it('accepts well-formed UUIDs', () => {
    expect(isValidSessionId(sessionId)).toBe(true);
    expect(isValidSessionId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId('../../etc/passwd')).toBe(false);
    expect(isValidSessionId('../escape')).toBe(false);
  });
});

describe('path traversal protection', () => {
  it('getSessionDetail rejects path traversal attempts', async () => {
    await expect(getSessionDetail('../../etc/passwd')).resolves.toBeNull();
    expect(accessMock).not.toHaveBeenCalled();
  });

  it('buildSessionContext rejects path traversal attempts', async () => {
    await expect(buildSessionContext('../../etc/passwd')).resolves.toBeNull();
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
