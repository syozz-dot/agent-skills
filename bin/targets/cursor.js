// bin/targets/cursor.js — Cursor target adapter.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmt } from '../lib/cli.js';
import { copyRecursive } from '../lib/copy.js';
import { detectExisting, writeMarker, MARKER_NAME } from '../lib/manifest.js';

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(__filename), '..', '..');

// Same path the README's symlink approach uses, so users can migrate cleanly.
const DEFAULT_INSTALL_DIR = path.join(
  os.homedir(),
  '.cursor', 'plugins', 'local', 'trtc-agent-skills',
);

// Subset of the package that gets copied into the Cursor install dir.
// (We don't ship Claude/Codex manifests into a Cursor install — those would
// confuse Cursor's plugin loader.)
const PAYLOAD_ENTRIES = [
  'skills',
  'knowledge-base',
  'hooks',
  'ai-instructions',
  '.cursor-plugin',
  '.cursor',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'README.zh.md',
];

function readPackageVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  );
  return pkg.version;
}

export function defaultInstallDir() {
  return DEFAULT_INSTALL_DIR;
}

export async function install({ installDir = DEFAULT_INSTALL_DIR, force = false } = {}) {
  const existing = detectExisting(installDir);

  // 1. Conflict detection.
  if (existing.kind === 'symlink') {
    if (!force) {
      console.error(
        fmt.warn('Found a symlink at ') + installDir +
        fmt.warn(' (probably the legacy git-clone install).\n') +
        fmt.hint('Re-run with --force to replace it with a managed copy.'),
      );
      process.exit(1);
    }
    fs.unlinkSync(installDir);
  } else if (existing.kind === 'unmanaged-dir') {
    if (!force) {
      console.error(
        fmt.warn('Found a non-empty directory at ') + installDir +
        fmt.warn(' without our install marker.\n') +
        fmt.hint('Re-run with --force to overwrite, or remove it manually first.'),
      );
      process.exit(1);
    }
    fs.rmSync(installDir, { recursive: true, force: true });
  } else if (existing.kind === 'managed' && !force) {
    console.error(
      fmt.warn(`Already installed (v${existing.version}, ${existing.installedAt}).\n`) +
      fmt.hint('Re-run with --force to reinstall.'),
    );
    process.exit(1);
  } else if (existing.kind === 'managed' && force) {
    fs.rmSync(installDir, { recursive: true, force: true });
  }

  // 2. Fresh install.
  fs.mkdirSync(installDir, { recursive: true });
  const written = [];
  for (const entry of PAYLOAD_ENTRIES) {
    const src = path.join(PACKAGE_ROOT, entry);
    const dst = path.join(installDir, entry);
    copyRecursive(src, dst, installDir, written);
  }

  // 3. Belt-and-suspenders: ensure plugin.json points at the Cursor hooks
  //    file (in case the source ever drifts).
  const pluginManifestPath = path.join(installDir, '.cursor-plugin', 'plugin.json');
  if (fs.existsSync(pluginManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(pluginManifestPath, 'utf8'));
    if (manifest.hooks !== './hooks/hooks-cursor.json') {
      manifest.hooks = './hooks/hooks-cursor.json';
      fs.writeFileSync(
        pluginManifestPath,
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8',
      );
    }
  }

  // 4. Make the adapter executable so Python's hashbang-via-bash dispatch works.
  const adapterPath = path.join(installDir, 'hooks', 'cursor-adapter.py');
  if (fs.existsSync(adapterPath)) {
    try { fs.chmodSync(adapterPath, 0o755); } catch { /* Windows: no-op */ }
  }

  // 5. Write the marker so uninstall knows what we did.
  const version = readPackageVersion();
  writeMarker(installDir, {
    target: 'cursor',
    version,
    installedAt: new Date().toISOString(),
    files: written,
  });

  // 6. Print next steps.
  console.log(fmt.ok('✔ ') + `Installed @tencent-rtc/agent-skills v${version} for Cursor.`);
  console.log(fmt.dim(`  Location: ${installDir}`));
  console.log('');
  console.log(fmt.bold('Next steps:'));
  console.log('  1. Open Cursor.');
  console.log('  2. ' + fmt.hint('Cmd/Ctrl+Shift+P → "Developer: Reload Window"') + ' to load the plugin.');
  console.log('  3. Try asking the agent: "Help me integrate TRTC voice call on Web."');
  console.log('');
  console.log(fmt.dim('To remove later: ') + 'npx @tencent-rtc/agent-skills uninstall');
}

export async function uninstall({ installDir = DEFAULT_INSTALL_DIR, force = false } = {}) {
  const existing = detectExisting(installDir);
  if (existing.kind === 'absent') {
    console.log('Nothing to uninstall (' + installDir + ' does not exist).');
    return;
  }
  if (existing.kind === 'symlink') {
    if (!force) {
      console.error(
        fmt.warn('Found a symlink (legacy install) at ') + installDir + '.\n' +
        fmt.hint('We won\'t remove it without --force, since we didn\'t create it.'),
      );
      process.exit(1);
    }
    fs.unlinkSync(installDir);
    console.log(fmt.ok('✔ ') + `Removed symlink at ${installDir}`);
    return;
  }
  if (existing.kind === 'unmanaged-dir' && !force) {
    console.error(
      fmt.warn('Directory at ') + installDir + fmt.warn(' has no install marker.\n') +
      fmt.hint('Re-run with --force to remove anyway.'),
    );
    process.exit(1);
  }
  fs.rmSync(installDir, { recursive: true, force: true });
  console.log(fmt.ok('✔ ') + `Removed ${installDir}`);
}

export async function info({ installDir = DEFAULT_INSTALL_DIR, json = false } = {}) {
  const existing = detectExisting(installDir);
  const out = { target: 'cursor', installDir, ...existing };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(fmt.bold('Target:     ') + 'cursor');
  console.log(fmt.bold('Install dir:') + ' ' + installDir);
  console.log(fmt.bold('Status:     ') + existing.kind);
  if (existing.kind === 'managed') {
    console.log(fmt.bold('Version:    ') + existing.version);
    console.log(fmt.bold('Installed:  ') + existing.installedAt);
    console.log(fmt.bold('Files:      ') + (existing.files?.length ?? 0));
  }
}

// Surface payload list for tests & external consumers.
export const _internals = { PAYLOAD_ENTRIES, PACKAGE_ROOT, MARKER_NAME };
