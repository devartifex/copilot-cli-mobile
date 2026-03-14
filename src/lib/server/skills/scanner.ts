import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface SkillDefinition {
  name: string;
  description: string;
  directory: string;
  license?: string;
  allowedTools?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && value) result[key] = value;
  }
  return result;
}

let cachedSkills: SkillDefinition[] | null = null;

/** Scan the skills directory and return all valid skill definitions. */
export async function scanSkills(skillsRoot?: string): Promise<SkillDefinition[]> {
  if (cachedSkills) return cachedSkills;

  const root = skillsRoot ?? resolve(process.cwd(), 'skills');
  const skills: SkillDefinition[] = [];

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // skills/ directory doesn't exist — no skills available
    cachedSkills = [];
    return [];
  }

  for (const entry of entries) {
    const dir = join(root, entry);
    const skillPath = join(dir, 'SKILL.md');

    try {
      const content = await readFile(skillPath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm.name) continue;

      skills.push({
        name: fm.name,
        description: fm.description ?? '',
        directory: dir,
        ...(fm.license && { license: fm.license }),
        ...(fm['allowed-tools'] && { allowedTools: fm['allowed-tools'] }),
      });
    } catch {
      // No SKILL.md or unreadable — skip
    }
  }

  cachedSkills = skills;
  return skills;
}

/** Get the absolute directory paths for all discovered skills. */
export async function getSkillDirectories(skillsRoot?: string): Promise<string[]> {
  const skills = await scanSkills(skillsRoot);
  return skills.map((s) => s.directory);
}

/** Clear the cached skills (for testing or hot-reload). */
export function clearSkillCache(): void {
  cachedSkills = null;
}
