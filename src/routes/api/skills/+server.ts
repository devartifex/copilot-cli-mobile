import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { scanSkills } from '$lib/server/skills/scanner.js';

export const GET: RequestHandler = async () => {
  const skills = await scanSkills();
  return json({
    skills: skills.map(({ name, description, license, allowedTools }) => ({
      name,
      description,
      license,
      allowedTools,
    })),
  });
};
