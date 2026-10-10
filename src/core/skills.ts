import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  content: string;
  path: string;
}

/** Carga skills desde <root>/skills/<nombre>/SKILL.md con frontmatter simple. */
export function loadSkills(skillsRoot: string): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(skillsRoot)) return skills;
  for (const dir of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(skillsRoot, dir.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    let name = dir.name;
    let description = '';
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    let body = raw;
    if (fm) {
      body = raw.slice(fm[0].length);
      for (const line of fm[1].split(/\r?\n/)) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (!m) continue;
        if (m[1] === 'name') name = m[2].trim();
        if (m[1] === 'description') description = m[2].trim();
      }
    }
    skills.push({ name, description, content: body.trim(), path: file });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
