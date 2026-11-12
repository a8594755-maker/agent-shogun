import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const defaultSkillRoot = fileURLToPath(new URL('../skills/multi-agent-dispatch/', import.meta.url));
export const defaultSkillCopy = fileURLToPath(new URL('../.agents/skills/multi-agent-dispatch/', import.meta.url));
export async function skillFiles(root, relative = '', files = new Map()) {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Skill copies must not contain symlinks.');
    if (entry.isDirectory()) await skillFiles(root, name, files);
    else if (entry.isFile()) files.set(name, await fs.readFile(path.join(root, name)));
  }
  return files;
}
export async function atomicText(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function syncSkill(source = defaultSkillRoot, destination = defaultSkillCopy) {
  source = path.resolve(source); destination = path.resolve(destination);
  const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
  if (inside(source, destination) || inside(destination, source)) throw new Error('Skill source and copy must be separate trees.');
  const wanted = await skillFiles(source);
  await fs.mkdir(destination, { recursive: true });
  const existing = await skillFiles(destination);
  for (const [name, content] of wanted) await atomicText(path.join(destination, name), content);
  // Remove individual obsolete files, never recursively delete a computed directory.
  for (const name of existing.keys()) if (!wanted.has(name)) await fs.unlink(path.join(destination, name));
  return { files: wanted.size };
}
