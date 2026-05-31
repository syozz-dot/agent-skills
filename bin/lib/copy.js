// bin/lib/copy.js — recursive directory copy that records every file written.
// Pure stdlib (Node ≥18 has fs.cpSync but we want a manifest of paths copied
// so the uninstaller can be precise).

import fs from 'node:fs';
import path from 'node:path';

const IGNORE_NAMES = new Set(['.DS_Store', '__pycache__', '.pytest_cache']);

/**
 * Recursively copy `src` into `dst`. Returns an array of dst-relative paths
 * (POSIX style) of every regular file written.
 *
 * `installRoot` is used to compute the relative paths in the returned list.
 */
export function copyRecursive(src, dst, installRoot, written = []) {
  if (!fs.existsSync(src)) return written;
  const stat = fs.statSync(src);

  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    // Preserve executable bit if the source has it.
    try {
      const mode = stat.mode & 0o777;
      if (mode & 0o111) fs.chmodSync(dst, mode);
    } catch {
      // chmod can fail on Windows or read-only fs — non-fatal.
    }
    written.push(toRelPosix(dst, installRoot));
    return written;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (IGNORE_NAMES.has(entry)) continue;
      copyRecursive(
        path.join(src, entry),
        path.join(dst, entry),
        installRoot,
        written,
      );
    }
    return written;
  }

  // Skip symlinks and other special files silently.
  return written;
}

function toRelPosix(absPath, root) {
  const rel = path.relative(root, absPath);
  return rel.split(path.sep).join('/');
}
