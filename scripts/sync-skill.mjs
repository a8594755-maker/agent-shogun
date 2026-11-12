import { syncSkill } from '../src/skill-sync.mjs';
const result = await syncSkill();
console.log(`Synchronized multi-agent-dispatch skill (${result.files} files).`);
