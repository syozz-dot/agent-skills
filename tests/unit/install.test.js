// tests/unit/install.test.js — end-to-end install/info/uninstall against a tmp dir.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'install.js');

function runCLI(args, opts = {}) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    ...opts,
  });
}

function tmpDir(prefix = 'trtc-install-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('--help prints usage', () => {
  const r = runCLI(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /trtc-agent-skills/);
  assert.match(r.stdout, /install/);
});

test('--version prints semver', () => {
  const r = runCLI(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('install populates target directory and writes marker', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  const r = runCLI(['install', '--install-dir', installDir]);
  assert.equal(r.status, 0, r.stderr);

  // Critical files are present.
  assert.ok(fs.existsSync(path.join(installDir, 'skills')),               'skills/ dir missing');
  assert.ok(fs.existsSync(path.join(installDir, 'hooks', 'hooks-cursor.json')), 'hooks-cursor.json missing');
  assert.ok(fs.existsSync(path.join(installDir, 'hooks', 'cursor-adapter.py')), 'adapter missing');
  assert.ok(fs.existsSync(path.join(installDir, '.cursor-plugin', 'plugin.json')), 'plugin manifest missing');
  assert.ok(fs.existsSync(path.join(installDir, '.trtc-installed-by-npx.json')),  'install marker missing');

  // Plugin manifest points to the Cursor hooks file.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installDir, '.cursor-plugin', 'plugin.json'), 'utf8'),
  );
  assert.equal(manifest.hooks, './hooks/hooks-cursor.json');

  // Adapter is executable on POSIX.
  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(installDir, 'hooks', 'cursor-adapter.py')).mode & 0o777;
    assert.ok(mode & 0o100, `adapter not executable (mode=${mode.toString(8)})`);
  }
});

test('install refuses re-install without --force', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  assert.equal(runCLI(['install', '--install-dir', installDir]).status, 0);

  const second = runCLI(['install', '--install-dir', installDir]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already installed/i);
});

test('install --force replaces existing install', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  assert.equal(runCLI(['install', '--install-dir', installDir]).status, 0);
  const second = runCLI(['install', '--install-dir', installDir, '--force']);
  assert.equal(second.status, 0, second.stderr);
});

test('install refuses to overwrite an unmanaged directory without --force', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  fs.mkdirSync(installDir);
  fs.writeFileSync(path.join(installDir, 'user-file.txt'), 'mine');

  const r = runCLI(['install', '--install-dir', installDir]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no(t|n).*marker|non-empty/i);
  // User file untouched.
  assert.ok(fs.existsSync(path.join(installDir, 'user-file.txt')));
});

test('info --json returns structured status', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  runCLI(['install', '--install-dir', installDir]);

  const r = runCLI(['info', '--install-dir', installDir, '--json']);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, 'managed');
  assert.equal(parsed.target, 'cursor');
});

test('uninstall removes a managed install', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  runCLI(['install', '--install-dir', installDir]);
  assert.ok(fs.existsSync(installDir));

  const r = runCLI(['uninstall', '--install-dir', installDir]);
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(installDir));
});

test('uninstall refuses an unmanaged dir without --force', () => {
  const dir = tmpDir();
  const installDir = path.join(dir, 'install');
  fs.mkdirSync(installDir);
  fs.writeFileSync(path.join(installDir, 'random.txt'), 'x');

  const r = runCLI(['uninstall', '--install-dir', installDir]);
  assert.notEqual(r.status, 0);
  assert.ok(fs.existsSync(installDir));  // untouched
});

test('unknown target fails fast with actionable message', () => {
  const r = runCLI(['install', '--target', 'claude-code']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not yet implemented|marketplace/i);
});

test('unknown flag fails with helpful error', () => {
  const r = runCLI(['install', '--bogus']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag/i);
});

// Regression: parseArgs must default installDir to undefined (not null), so
// that target modules' default-parameter values (e.g. cursor.js's
// DEFAULT_INSTALL_DIR) actually kick in when the user doesn't pass
// --install-dir. Earlier versions left this as null, which silently broke
// `npx ... install` with no flags because mkdirSync(null) throws.
test('install without --install-dir uses target default (does not crash)', () => {
  // We can't actually install into ~/.cursor in a unit test, so we use
  // `info` instead — it goes through the same arg-parsing path and just
  // reports status. Its success proves installDir defaulting works.
  const r = runCLI(['info', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.target, 'cursor');
  // Default install dir should be a non-empty string under the home dir.
  assert.match(parsed.installDir, /\.cursor[\/\\]plugins[\/\\]local[\/\\]trtc-agent-skills$/);
});
