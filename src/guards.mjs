export function childEnv(config, source = process.env, platform = process.platform) {
  const env = {};
  const matching=name=>Object.keys(env).find(key=>platform==='win32'?key.toLowerCase()===name.toLowerCase():key===name);
  for(const [name,value]of Object.entries(source)){const old=matching(name);if(old)delete env[old];env[name]=value;}
  for (const [name, value] of Object.entries(config.guards.env || {})) {
    const old=matching(name);if(old)delete env[old];
    if (value !== null) env[name] = value;
  }
  if (config.guards.blockPush) {
    const count = Number(env[matching('GIT_CONFIG_COUNT')] || 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw new Error('Invalid inherited GIT_CONFIG_COUNT.');
    const old=matching('GIT_CONFIG_COUNT');if(old)delete env[old];env.GIT_CONFIG_COUNT = String(count + 1);
    for(const key of [`GIT_CONFIG_KEY_${count}`,`GIT_CONFIG_VALUE_${count}`]){const old=matching(key);if(old)delete env[old];}
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
