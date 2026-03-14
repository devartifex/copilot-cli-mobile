import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkills, getSkillDirectories, clearSkillCache } from './scanner.js';

describe('skill scanner', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearSkillCache();
    tempDir = await mkdtemp(join(tmpdir(), 'skills-test-'));
  });

  afterEach(async () => {
    clearSkillCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when skills directory does not exist', async () => {
    const skills = await scanSkills('/nonexistent/path');
    expect(skills).toEqual([]);
  });

  it('returns empty array when skills directory is empty', async () => {
    const skills = await scanSkills(tempDir);
    expect(skills).toEqual([]);
  });

  it('discovers a valid SKILL.md with frontmatter', async () => {
    const skillDir = join(tempDir, 'test-skill');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: test-skill',
      "description: 'A test skill for testing'",
      'license: MIT',
      'allowed-tools: Bash',
      '---',
      '',
      '# Test Skill',
      '',
      'Some instructions here.',
    ].join('\n'));

    const skills = await scanSkills(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toEqual({
      name: 'test-skill',
      description: 'A test skill for testing',
      directory: skillDir,
      license: 'MIT',
      allowedTools: 'Bash',
    });
  });

  it('skips directories without SKILL.md', async () => {
    await mkdir(join(tempDir, 'no-skill'));
    await writeFile(join(tempDir, 'no-skill', 'README.md'), '# Not a skill');

    const skills = await scanSkills(tempDir);
    expect(skills).toEqual([]);
  });

  it('skips SKILL.md files without a name in frontmatter', async () => {
    const skillDir = join(tempDir, 'nameless');
    await mkdir(skillDir);
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      "description: 'No name field'",
      '---',
      '',
      '# Nameless',
    ].join('\n'));

    const skills = await scanSkills(tempDir);
    expect(skills).toEqual([]);
  });

  it('discovers multiple skills', async () => {
    for (const name of ['alpha', 'beta']) {
      const dir = join(tempDir, name);
      await mkdir(dir);
      await writeFile(join(dir, 'SKILL.md'), [
        '---',
        `name: ${name}`,
        `description: 'Skill ${name}'`,
        '---',
        '',
        `# ${name}`,
      ].join('\n'));
    }

    const skills = await scanSkills(tempDir);
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('getSkillDirectories returns absolute directory paths', async () => {
    const dir = join(tempDir, 'my-skill');
    await mkdir(dir);
    await writeFile(join(dir, 'SKILL.md'), [
      '---',
      'name: my-skill',
      'description: Test',
      '---',
      '',
      '# My Skill',
    ].join('\n'));

    const dirs = await getSkillDirectories(tempDir);
    expect(dirs).toEqual([dir]);
  });

  it('caches results after first scan', async () => {
    const dir = join(tempDir, 'cached');
    await mkdir(dir);
    await writeFile(join(dir, 'SKILL.md'), '---\nname: cached\ndescription: Test\n---\n# Cached');

    const first = await scanSkills(tempDir);
    expect(first).toHaveLength(1);

    // Add another skill — should not appear due to cache
    const dir2 = join(tempDir, 'new-skill');
    await mkdir(dir2);
    await writeFile(join(dir2, 'SKILL.md'), '---\nname: new\ndescription: New\n---\n# New');

    const second = await scanSkills(tempDir);
    expect(second).toHaveLength(1); // Still cached

    // After clearing cache, new scan should find both
    clearSkillCache();
    const third = await scanSkills(tempDir);
    expect(third).toHaveLength(2);
  });
});
