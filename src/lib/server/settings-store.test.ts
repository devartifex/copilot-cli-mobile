import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const {
  mkdirMock,
  randomUUIDMock,
  readFileMock,
  renameMock,
  writeFileMock,
} = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  randomUUIDMock: vi.fn(),
  readFileMock: vi.fn(),
  renameMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
    default: {
      ...actual,
      randomUUID: randomUUIDMock,
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdir: mkdirMock,
      readFile: readFileMock,
      rename: renameMock,
      writeFile: writeFileMock,
    },
    mkdir: mkdirMock,
    readFile: readFileMock,
    rename: renameMock,
    writeFile: writeFileMock,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      mkdir: mkdirMock,
      readFile: readFileMock,
      rename: renameMock,
      writeFile: writeFileMock,
    },
    mkdir: mkdirMock,
    readFile: readFileMock,
    rename: renameMock,
    writeFile: writeFileMock,
  };
});

vi.mock('./config.js', () => ({
  config: {
    settingsStorePath: '/settings-store',
  },
}));

import { loadUserSettings, saveUserSettings } from './settings-store.js';

interface PersistedSettings {
  model: string;
  mode: string;
  reasoningEffort: string;
  customInstructions: string;
  excludedTools: string[];
  customTools: unknown[];
  mcpServers?: unknown[];
}

const sampleSettings: PersistedSettings = {
  model: 'gpt-4.1',
  mode: 'interactive',
  reasoningEffort: 'medium',
  customInstructions: 'Be helpful.',
  excludedTools: ['bash'],
  customTools: [{ name: 'lint' }],
  mcpServers: [{ name: 'github' }],
};

beforeEach(() => {
  mkdirMock.mockReset();
  randomUUIDMock.mockReset();
  readFileMock.mockReset();
  renameMock.mockReset();
  writeFileMock.mockReset();

  mkdirMock.mockResolvedValue(undefined);
  randomUUIDMock.mockReturnValue('uuid-1');
  renameMock.mockResolvedValue(undefined);
  writeFileMock.mockResolvedValue(undefined);

  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadUserSettings', () => {
  it('reads and parses settings from the user JSON file', async () => {
    readFileMock.mockResolvedValue(JSON.stringify(sampleSettings));

    await expect(loadUserSettings('User.Name!')).resolves.toEqual(sampleSettings);
    expect(readFileMock).toHaveBeenCalledWith(join('/settings-store', 'username.json'), 'utf-8');
  });

  it('returns null when the settings file is missing so callers can apply defaults', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    await expect(loadUserSettings('missing-user')).resolves.toBeNull();
  });

  it('returns null when the settings file contains corrupted JSON', async () => {
    readFileMock.mockResolvedValue('{ invalid json');

    await expect(loadUserSettings('broken-user')).resolves.toBeNull();
  });

  it('returns null for invalid usernames', async () => {
    await expect(loadUserSettings('!!!')).resolves.toBeNull();
    expect(readFileMock).not.toHaveBeenCalled();
  });
});

describe('saveUserSettings', () => {
  it('writes settings through an atomic sibling temp file and renames into place', async () => {
    await saveUserSettings('Test_User', sampleSettings);

    const filePath = join('/settings-store', 'test_user.json');
    const tmpPath = join('/settings-store', '.test_user.1700000000000-uuid-1.tmp');

    expect(mkdirMock).toHaveBeenCalledWith('/settings-store', { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(tmpPath, JSON.stringify(sampleSettings), 'utf-8');
    expect(renameMock).toHaveBeenCalledWith(tmpPath, filePath);
  });

  it('sanitizes usernames consistently when saving', async () => {
    await saveUserSettings('Name.With Spaces!', sampleSettings);

    const tmpPath = join('/settings-store', '.namewithspaces.1700000000000-uuid-1.tmp');
    const filePath = join('/settings-store', 'namewithspaces.json');
    expect(writeFileMock).toHaveBeenCalledWith(tmpPath, JSON.stringify(sampleSettings), 'utf-8');
    expect(renameMock).toHaveBeenCalledWith(tmpPath, filePath);
  });

  it('rejects oversized settings payloads before touching the filesystem', async () => {
    const oversized: PersistedSettings = {
      ...sampleSettings,
      customInstructions: 'x'.repeat(60_000),
    };

    await expect(saveUserSettings('user', oversized)).rejects.toThrow('Settings data exceeds maximum size');
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('rejects invalid usernames', async () => {
    await expect(saveUserSettings('!!!', sampleSettings)).rejects.toThrow('Invalid username');
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it('propagates write failures', async () => {
    writeFileMock.mockRejectedValue(new Error('disk full'));

    await expect(saveUserSettings('writer', sampleSettings)).rejects.toThrow('disk full');
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('propagates rename failures after writing the temp file', async () => {
    renameMock.mockRejectedValue(new Error('EXDEV'));

    await expect(saveUserSettings('writer', sampleSettings)).rejects.toThrow('EXDEV');
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it('uses unique temp files for concurrent writes', async () => {
    randomUUIDMock.mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');

    await Promise.all([
      saveUserSettings('parallel', sampleSettings),
      saveUserSettings('parallel', sampleSettings),
    ]);

    const tempPaths = writeFileMock.mock.calls.map(([filePath]) => filePath);
    expect(tempPaths).toEqual([
      join('/settings-store', '.parallel.1700000000000-uuid-a.tmp'),
      join('/settings-store', '.parallel.1700000000000-uuid-b.tmp'),
    ]);
  });
});
