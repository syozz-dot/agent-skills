// bin/lib/manifest.js — read/write the .trtc-installed-by-npx.json marker.
// The marker lets uninstall know what to remove and lets install detect
// pre-existing installs.

import fs from 'node:fs';
import path from 'node:path';

export const MARKER_NAME = '.trtc-installed-by-npx.json';
export const SCHEMA_VERSION = 1;

/** Write the marker file inside `installDir`. Throws on I/O error. */
export function writeMarker(installDir, payload) {
  const full = {
    schema: SCHEMA_VERSION,
    target: payload.target,
    version: payload.version,
    installedAt: payload.installedAt || new Date().toISOString(),
    files: payload.files || [],
  };
  fs.writeFileSync(
    path.join(installDir, MARKER_NAME),
    JSON.stringify(full, null, 2) + '\n',
    'utf8',
  );
  return full;
}

/** Read the marker if present and parseable; otherwise null. */
export function readMarker(installDir) {
  const p = path.join(installDir, MARKER_NAME);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof data !== 'object' || data === null) return null;
    if (data.schema !== SCHEMA_VERSION) {
      // Forward-compatible: surface the marker but flag the schema mismatch
      // so callers can decide whether to overwrite.
      return { ...data, _schemaMismatch: true };
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Classify the state of `installDir`:
 *   - 'absent'         — directory doesn't exist
 *   - 'symlink'        — a symlink (likely the legacy git-clone install)
 *   - 'managed'        — managed by us, marker present
 *   - 'unmanaged-dir'  — directory exists but no marker (someone else's data)
 */
export function detectExisting(installDir) {
  if (!fs.existsSync(installDir)) {
    // Could be a dangling symlink; lstat tells us.
    try {
      const lst = fs.lstatSync(installDir);
      if (lst.isSymbolicLink()) {
        return { kind: 'symlink', target: fs.readlinkSync(installDir) };
      }
    } catch {
      // ENOENT — really absent.
    }
    return { kind: 'absent' };
  }
  const lst = fs.lstatSync(installDir);
  if (lst.isSymbolicLink()) {
    return { kind: 'symlink', target: fs.readlinkSync(installDir) };
  }
  const m = readMarker(installDir);
  if (m) {
    return { kind: 'managed', version: m.version, installedAt: m.installedAt, files: m.files };
  }
  return { kind: 'unmanaged-dir' };
}
