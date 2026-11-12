export function childEnv(config, source = process.env) {
  const env = { ...source };
  for (const [name, value] of Object.entries(config.guards.env || {})) {
    if (value === null) delete env[name];
    else env[name] = value;
  }
  if (config.guards.blockPush) {
    const count = Number(env.GIT_CONFIG_COUNT || 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new Error('Invalid inherited GIT_CONFIG_COUNT.');
    env.GIT_CONFIG_COUNT = String(count + 1);
    env[`GIT_CONFIG_KEY_${count}`] = 'remote.origin.pushurl';
    env[`GIT_CONFIG_VALUE_${count}`] = 'disabled://roster-do-not-push';
  }
  return env;
}
export function agySettings(config, web, access) {
  const deny = config.guards.antigravityDeny ? [
    'command(regex:.*git\\s+(push|merge|checkout|switch|reset|stash|rebase|worktree|branch|tag|clean|restore|fetch|pull)(\\s.*|$))',
    'command(regex:.*(wrangler|vercel|netlify|firebase|deploy|publish)(\\s.*|$))',
    'command(regex:.*(gh|ssh|scp)\\s.*)',
    ...(!web ? ['command(regex:.*(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\\s.*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)'] : [])
  ] : [];
  return { toolPermission: 'always-proceed', enableTerminalSandbox: access === 'safe', allowNonWorkspaceAccess: access === 'full', permissions: { deny } };
}
