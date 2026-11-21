'use strict';

const fs = require('fs');
const path = require('path');

// Folders we never walk into while searching (they never hold real projects).
const SKIP = new Set(['.git', '.hg', '.svn', '.cache', '.Trash', 'Library']);

/**
 * Find every top-level node_modules folder under `root`.
 * Nested node_modules (inside another node_modules) are counted as part
 * of their parent, not listed separately.
 *
 * @param {string} root
 * @param {{ maxDepth?: number }} [options]
 * @returns {string[]} absolute paths
 */
function findNodeModules(root, options = {}) {
  const maxDepth = options.maxDepth ?? 8;
  const found = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no permission or vanished: skip quietly
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue; // also skips symlinks
      const full = path.join(dir, e.name);
      if (e.name === 'node_modules') {
        found.push(full);
      } else if (!SKIP.has(e.name)) {
        walk(full, depth + 1);
      }
    }
  }

  walk(path.resolve(root), 0);
  return found;
}

/**
 * Total size in bytes of everything inside `dir`. Does not follow symlinks.
 * @param {string} dir
 * @returns {number}
 */
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += fs.lstatSync(full).size;
        } catch {
          /* file vanished */
        }
      }
    }
  }
  return total;
}

/**
 * When the project that owns a node_modules folder was last changed:
 * the newest modification time of the project's own top-level files
 * (node_modules itself is ignored, since installs touch it).
 *
 * @param {string} nodeModulesPath
 * @returns {Date}
 */
function lastModified(nodeModulesPath) {
  const project = path.dirname(nodeModulesPath);
  const mtime = (p) => {
    try {
      return fs.lstatSync(p).mtimeMs;
    } catch {
      return 0; // vanished or unreadable
    }
  };
  let names = [];
  try {
    names = fs.readdirSync(project).filter((n) => n !== 'node_modules');
  } catch {
    /* ignore */
  }
  const newest = Math.max(0, ...names.map((n) => mtime(path.join(project, n))));
  return new Date(newest || mtime(project) || Date.now());
}

/**
 * Scan `root` and return one record per node_modules folder,
 * biggest first.
 *
 * @param {string} root
 * @param {{ maxDepth?: number, olderThanDays?: number }} [options]
 * @returns {{ path: string, project: string, size: number, modified: Date, ageDays: number }[]}
 */
function scan(root, options = {}) {
  const now = Date.now();
  const results = findNodeModules(root, options).map((p) => {
    const modified = lastModified(p);
    return {
      path: p,
      project: path.dirname(p),
      size: dirSize(p),
      modified,
      ageDays: Math.floor((now - modified.getTime()) / 86400000),
    };
  });

  const filtered =
    options.olderThanDays != null
      ? results.filter((r) => r.ageDays >= options.olderThanDays)
      : results;

  return filtered.sort((a, b) => b.size - a.size);
}

/**
 * Delete a node_modules folder. Refuses anything not named node_modules,
 * so a bug can never wipe a real project.
 * @param {string} p
 */
function remove(p) {
  if (path.basename(p) !== 'node_modules') {
    throw new Error(`Refusing to delete a folder not named node_modules: ${p}`);
  }
  fs.rmSync(p, { recursive: true, force: true });
}

module.exports = { findNodeModules, dirSize, lastModified, scan, remove };
