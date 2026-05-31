// tests/unit/cursor-adapter.test.js — adapter dispatch + payload translation.
//
// Strategy: replace each guardrail script with a tiny stub in a fake plugin
// root, then run the adapter and assert the right script ran with the right
// stdin/env.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const ADAPTER  = path.join(REPO_ROOT, 'hooks', 'cursor-adapter.py');

// Map of dispatch keys -> relative script paths the adapter dispatches to.
// Mirrors the DISPATCH dict inside cursor-adapter.py — keep in sync.
const DISPATCH = {
  'trtc-prepare-ui':      'skills/trtc/room-builder/guardrails/trtc_prepare_ui.py',
  'gate-slice-read':      'skills/trtc-topic/guardrails/gate_slice_read.py',
  'gate-slice-write':     'skills/trtc-topic/guardrails/gate_slice_write.py',
  'verify-ui-post-write': 'skills/trtc/room-builder/guardrails/verify_ui_post_write.sh',
  'verify-slice-must':    'skills/trtc-apply/guardrails/verify_slice_must_rules.py',
  'stop-apply-evidence':  'skills/trtc-topic/guardrails/stop_require_apply_evidence.py',
  'trtc-verify-ui':       'skills/trtc/room-builder/guardrails/trtc_verify_ui.py',
  'verify-apply-project': 'skills/trtc-apply/guardrails/verify_apply_project.py',
};

function tmpPluginRoot() {
  // realpathSync resolves macOS's /var → /private/var symlink, matching what
  // Path.resolve() inside cursor-adapter.py will report via __file__.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trtc-adapter-')));
  // Adapter lives at <root>/hooks/cursor-adapter.py — copy the real adapter
  // into the fake root so __file__-based PLUGIN_ROOT resolution works.
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.copyFileSync(ADAPTER, path.join(root, 'hooks', 'cursor-adapter.py'));
  return root;
}

/**
 * Plant a stub guardrail at `relPath` inside `root`. The stub records the
 * stdin and env it received, then exits with `exitCode`.
 *
 * Stub writes <root>/hook-trace.json with whatever it observed.
 */
function plantStub(root, relPath, { exitCode = 0, stderrText = '' } = {}) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const isShell = abs.endsWith('.sh');
  const tracePath = path.join(root, 'hook-trace.json').replace(/\\/g, '/');
  const stderrEsc = stderrText.replace(/'/g, "'\\''");

  const py = `#!/usr/bin/env python3
import sys, os, json
data = sys.stdin.read()
trace = {
  'stdin': data,
  'env_CLAUDE_PLUGIN_ROOT': os.environ.get('CLAUDE_PLUGIN_ROOT', ''),
  'env_CLAUDE_PROJECT_DIR': os.environ.get('CLAUDE_PROJECT_DIR', ''),
  'argv': sys.argv,
}
with open(${JSON.stringify(tracePath)}, 'w') as f:
    json.dump(trace, f)
if ${JSON.stringify(stderrText)}:
    sys.stderr.write(${JSON.stringify(stderrText)})
sys.exit(${exitCode})
`;

  const sh = `#!/usr/bin/env bash
data=$(cat)
cat > ${JSON.stringify(tracePath)} <<EOF
{"stdin": $(printf '%s' "$data" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'), "env_CLAUDE_PLUGIN_ROOT": "${'$'}CLAUDE_PLUGIN_ROOT", "env_CLAUDE_PROJECT_DIR": "${'$'}CLAUDE_PROJECT_DIR"}
EOF
[ -n '${stderrEsc}' ] && echo -n '${stderrEsc}' >&2
exit ${exitCode}
`;

  fs.writeFileSync(abs, isShell ? sh : py);
  fs.chmodSync(abs, 0o755);
}

function runAdapter(root, dispatchKey, stdin = '', extraEnv = {}) {
  const adapter = path.join(root, 'hooks', 'cursor-adapter.py');
  return spawnSync('python3', [adapter, dispatchKey], {
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, ...extraEnv },
  });
}

function readTrace(root) {
  const p = path.join(root, 'hook-trace.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('unknown dispatch key is silent allow', () => {
  const root = tmpPluginRoot();
  const r = runAdapter(root, 'totally-bogus-key');
  assert.equal(r.status, 0);
});

test('missing target script is silent allow', () => {
  const root = tmpPluginRoot();
  // Don't plant anything — script doesn't exist.
  const r = runAdapter(root, 'gate-slice-read', JSON.stringify({ file_path: '/x' }));
  assert.equal(r.status, 0);
});

test('beforeReadFile payload is translated to {tool_name: Read, tool_input.file_path}', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['gate-slice-read'], { exitCode: 0 });

  const r = runAdapter(root, 'gate-slice-read', JSON.stringify({
    file_path: '/repo/knowledge-base/slices/conference/web/login-auth.md',
    content: '...',
    hook_event_name: 'beforeReadFile',
  }));
  assert.equal(r.status, 0);

  const trace = readTrace(root);
  assert.ok(trace, 'stub did not run');
  const seen = JSON.parse(trace.stdin);
  assert.equal(seen.tool_name, 'Read');
  assert.equal(seen.tool_input.file_path, '/repo/knowledge-base/slices/conference/web/login-auth.md');
});

test('preToolUse with non-Write tool triggers silent allow (no stub call)', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['gate-slice-write'], { exitCode: 2, stderrText: 'should not fire' });

  const r = runAdapter(root, 'gate-slice-write', JSON.stringify({
    tool_name: 'Shell',
    tool_input: { command: 'ls' },
  }));
  assert.equal(r.status, 0);
  // Stub should NOT have run — adapter short-circuited.
  assert.equal(readTrace(root), null);
});

test('preToolUse with Write tool dispatches with normalized payload', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['gate-slice-write'], { exitCode: 0 });

  const r = runAdapter(root, 'gate-slice-write', JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: '/proj/src/main.ts' },
  }));
  assert.equal(r.status, 0);

  const trace = readTrace(root);
  const seen = JSON.parse(trace.stdin);
  assert.equal(seen.tool_name, 'Write');
  assert.equal(seen.tool_input.file_path, '/proj/src/main.ts');
});

test('afterFileEdit payload is translated for verify-slice-must', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['verify-slice-must'], { exitCode: 0 });

  const r = runAdapter(root, 'verify-slice-must', JSON.stringify({
    file_path: '/proj/src/Room.vue',
    edits: [{ old_string: 'a', new_string: 'b' }],
  }));
  assert.equal(r.status, 0);

  const trace = readTrace(root);
  const seen = JSON.parse(trace.stdin);
  assert.equal(seen.tool_name, 'Edit');
  assert.equal(seen.tool_input.file_path, '/proj/src/Room.vue');
});

test('CLAUDE_PLUGIN_ROOT is exported to the inner script', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['trtc-prepare-ui'], { exitCode: 0 });

  const r = runAdapter(root, 'trtc-prepare-ui');
  assert.equal(r.status, 0);

  const trace = readTrace(root);
  assert.ok(trace, 'stub did not run');
  assert.equal(trace.env_CLAUDE_PLUGIN_ROOT, root);
});

test('CURSOR_PROJECT_DIR is forwarded as CLAUDE_PROJECT_DIR', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['trtc-prepare-ui'], { exitCode: 0 });

  const r = runAdapter(root, 'trtc-prepare-ui', '', {
    CURSOR_PROJECT_DIR: '/some/project',
    CLAUDE_PROJECT_DIR: '',  // ensure adapter sets it
  });
  assert.equal(r.status, 0);

  const trace = readTrace(root);
  assert.equal(trace.env_CLAUDE_PROJECT_DIR, '/some/project');
});

test('exit code 2 from inner script becomes Cursor deny envelope + exit 2', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['gate-slice-read'], {
    exitCode: 2,
    stderrText: 'Slice read out of bounds — finish current slice first.',
  });

  const r = runAdapter(root, 'gate-slice-read', JSON.stringify({
    file_path: '/repo/knowledge-base/slices/conference/web/x.md',
  }));
  assert.equal(r.status, 2);
  // stdout should be a JSON deny envelope
  const env = JSON.parse(r.stdout);
  assert.equal(env.permission, 'deny');
  assert.match(env.agent_message, /Slice read out of bounds/);
});

test('exit code 1 is also mapped to deny (existing scripts use 1 for fail)', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['verify-slice-must'], {
    exitCode: 1,
    stderrText: 'MUST-rule check failed',
  });
  const r = runAdapter(root, 'verify-slice-must', JSON.stringify({
    file_path: '/p/x.vue',
  }));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"permission":\s*"deny"/);
});

test('malformed stdin is silent allow', () => {
  const root = tmpPluginRoot();
  plantStub(root, DISPATCH['gate-slice-read'], { exitCode: 0 });
  const r = runAdapter(root, 'gate-slice-read', 'not json at all');
  // Adapter still dispatches with empty payload; inner stub exits 0; net 0.
  assert.equal(r.status, 0);
});
