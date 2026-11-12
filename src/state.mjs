import os from 'node:os';
import path from 'node:path';

export function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export function stateDirectory(root) {
  const file = path.resolve(process.env.ROSTER_STATE_DIR || path.join(root, '.roster'));
  if ((process.env.ROSTER_TEST_MODE || process.env.NODE_TEST_CONTEXT) && (!process.env.ROSTER_TEST_ROOT || !process.env.ROSTER_STATE_DIR || !within(process.env.ROSTER_TEST_ROOT, file))) throw new Error('Test isolation required: refusing repository state outside the temporary test root.');
  return file;
}
export function rosterHome() {
  const home = path.resolve(process.env.ROSTER_HOME || path.join(os.homedir(), '.roster'));
  if ((process.env.ROSTER_TEST_MODE || process.env.NODE_TEST_CONTEXT) && (!process.env.ROSTER_TEST_ROOT || !process.env.ROSTER_HOME || !within(process.env.ROSTER_TEST_ROOT, home))) throw new Error('Test isolation required: refusing real roster home.');
  return home;
}
