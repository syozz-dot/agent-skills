#!/usr/bin/env node
// bin/install.js — entry point for `npx @tencent-rtc/agent-skills`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, HELP_TEXT, fmt, die } from './lib/cli.js';
import { targets } from './targets/index.js';

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), '..');

function readVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  return pkg.version;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === 'help') {
    console.log(HELP_TEXT);
    return;
  }
  if (opts.command === 'version') {
    console.log(readVersion());
    return;
  }

  const target = targets[opts.target];
  if (!target) {
    die(`Unknown target: ${opts.target}. Available: ${Object.keys(targets).join(', ')}`);
  }

  const args = {
    installDir: opts.installDir,  // may be undefined → target uses its default
    force: opts.force,
    json: opts.json,
  };

  switch (opts.command) {
    case 'install':   return target.install(args);
    case 'uninstall': return target.uninstall(args);
    case 'info':      return target.info(args);
    default:
      die(`Unknown command: ${opts.command}. Run 'trtc-agent-skills --help' for usage.`);
  }
}

main().catch((err) => {
  console.error(fmt.err('Unexpected error: ') + (err?.stack || err?.message || String(err)));
  process.exit(1);
});
