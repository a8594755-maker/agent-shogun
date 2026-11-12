import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../skills/multi-agent-dispatch/SKILL.md', import.meta.url));
const target = fileURLToPath(new URL('../.agents/skills/multi-agent-dispatch/SKILL.md', import.meta.url));
await fs.mkdir(fileURLToPath(new URL('../.agents/skills/multi-agent-dispatch/', import.meta.url)), { recursive: true });
await fs.copyFile(source, target);
console.log('Synchronized multi-agent-dispatch skill.');
