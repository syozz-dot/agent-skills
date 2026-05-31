// tests/unit/manifest.test.js — round-trip and conflict-detection coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeMarker, readMarker, detectExisting, MARKER_NAME, SCHEMA_VERSION }
  from '../../bin/lib/manifest.js';

function tmpDir(prefix = 'trtc-marker-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('writeMarker + readMarker round trip', () => {
  const dir = tmpDir();
  const written = writeMarker(dir, { target: 'cursor', version: '0.1.0', files: ['a/b.txt'] });
  assert.equal(written.schema, SCHEMA_VERSION);
  const read = readMarker(dir);
  assert.deepEqual(read.target, 'cursor');
  assert.deepEqual(read.files, ['a/b.txt']);
  assert.equal(read.version, '0.1.0');
});

test('readMarker returns null on missing file', () => {
  const dir = tmpDir();
  assert.equal(readMarker(dir), null);
});

test('readMarker returns null on malformed JSON', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, MARKER_NAME), '{not valid json');
  assert.equal(readMarker(dir), null);
});

test('readMarker flags schema mismatch but still returns data', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, MARKER_NAME),
    JSON.stringify({ schema: 999, target: 'cursor', version: '9.9.9' }),
  );
  const m = readMarker(dir);
  assert.equal(m._schemaMismatch, true);
  assert.equal(m.version, '9.9.9');
});

test('detectExisting recognizes absent dir', () => {
  const dir = path.join(os.tmpdir(), 'definitely-does-not-exist-' + Date.now());
  assert.equal(detectExisting(dir).kind, 'absent');
});

test('detectExisting recognizes managed dir', () => {
  const dir = tmpDir();
  writeMarker(dir, { target: 'cursor', version: '0.1.0', files: [] });
  const e = detectExisting(dir);
  assert.equal(e.kind, 'managed');
  assert.equal(e.version, '0.1.0');
});

test('detectExisting recognizes unmanaged dir', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'somefile.txt'), 'hi');
  assert.equal(detectExisting(dir).kind, 'unmanaged-dir');
});

test('detectExisting recognizes symlink', () => {
  // Skip on Windows if symlink creation fails.
  const root = tmpDir();
  const target = path.join(root, 'real');
  fs.mkdirSync(target);
  const link = path.join(root, 'link');
  try {
    fs.symlinkSync(target, link, 'dir');
  } catch {
    return;  // platform doesn't allow user-mode symlinks; skip
  }
  const e = detectExisting(link);
  assert.equal(e.kind, 'symlink');
  assert.equal(e.target, target);
});
