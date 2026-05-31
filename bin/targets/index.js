// bin/targets/index.js — target registry.
//
// v1 ships with `cursor` only. The other entries are stubs that fail fast
// with a useful message so users see exactly where to look for v2 support.
// Adding a new target is just dropping a module that exports
// { install, uninstall, info, defaultInstallDir? } and registering it here.

import * as cursor from './cursor.js';

function notImplementedTarget(name) {
  return {
    install: () => bail(name),
    uninstall: () => bail(name),
    info: () => bail(name),
  };
}

function bail(name) {
  console.error(
    `Target '${name}' is not yet implemented in this version.\n` +
    `For now, install via the native plugin marketplace:\n` +
    `  - Claude Code: /add-plugin Tencent-RTC/agent-skills\n` +
    `  - Codex CLI:   add the marketplace, then install 'trtc-agent-skills'\n` +
    `npx support for ${name} is tracked at https://github.com/Tencent-RTC/agent-skills/issues`,
  );
  process.exit(2);
}

export const targets = {
  cursor,
  'claude-code': notImplementedTarget('claude-code'),
  codex:         notImplementedTarget('codex'),
  codebuddy:     notImplementedTarget('codebuddy'),
};
