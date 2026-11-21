'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scan, findNodeModules, dirSize, remove, formatBytes, formatAge, parseSelection } = require('../src/index');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
const DAY = 86400000;

/** Build a fake workspace:
 *  root/old-app      (node_modules 3000 bytes, touched 100 days ago)
 *  root/new-app      (node_modules 1000 bytes, touched today, has nested node_modules)
 *  root/group/deep   (node_modules 500 bytes)
 *  root/no-deps      (no node_modules)
 */
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sweep-'));
  const make = (project, bytes, ageDays = 0) => {
    const dir = path.join(root, project);
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(bytes));
    const pj = path.join(dir, 'package.json');
    fs.writeFileSync(pj, '{}');
    const t = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(pj, t, t);
    return dir;
  };
  make('old-app', 3000, 100);
  const newApp = make('new-app', 1000, 0);
  fs.mkdirSync(path.join(newApp, 'node_modules', 'pkg', 'node_modules', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(newApp, 'node_modules', 'pkg', 'node_modules', 'inner', 'a.js'), 'y'.repeat(200));
  make('group/deep', 500, 40);
  fs.mkdirSync(path.join(root, 'no-deps'));
  fs.writeFileSync(path.join(root, 'no-deps', 'package.json'), '{}');
  return root;
}

function cli(args, input) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', input, env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('finds only top-level node_modules, skips nested ones', () => {
  const root = workspace();
  const found = findNodeModules(root).map((p) => path.relative(root, p)).sort();
  assert.deepStrictEqual(found, [
    path.join('group', 'deep', 'node_modules'),
    path.join('new-app', 'node_modules'),
    path.join('old-app', 'node_modules'),
  ]);
});

test('dirSize counts nested files', () => {
  const root = workspace();
  assert.strictEqual(dirSize(path.join(root, 'new-app', 'node_modules')), 1200);
});

test('scan sorts biggest first and computes age', () => {
  const root = workspace();
  const r = scan(root);
  assert.deepStrictEqual(r.map((x) => x.size), [3000, 1200, 500]);
  assert.ok(r[0].ageDays >= 99 && r[0].ageDays <= 100);
});

test('olderThanDays filters recent projects', () => {
  const root = workspace();
  const r = scan(root, { olderThanDays: 30 }).map((x) => path.basename(x.project)).sort();
  assert.deepStrictEqual(r, ['deep', 'old-app']);
});

test('remove deletes node_modules but refuses other folders', () => {
  const root = workspace();
  const nm = path.join(root, 'old-app', 'node_modules');
  remove(nm);
  assert.strictEqual(fs.existsSync(nm), false);
  assert.ok(fs.existsSync(path.join(root, 'old-app', 'package.json')));
  assert.throws(() => remove(path.join(root, 'new-app')), /Refusing/);
});

test('formatBytes and formatAge', () => {
  assert.strictEqual(formatBytes(500), '500 B');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(formatBytes(3 * 1024 ** 3), '3.0 GB');
  assert.strictEqual(formatAge(0), 'today');
  assert.strictEqual(formatAge(1), '1 day ago');
  assert.strictEqual(formatAge(65), '2 months ago');
  assert.strictEqual(formatAge(800), '2 years ago');
});

test('parseSelection handles lists, ranges, all and junk', () => {
  assert.deepStrictEqual(parseSelection('1,3-5', 10), [1, 3, 4, 5]);
  assert.deepStrictEqual(parseSelection('a', 3), [1, 2, 3]);
  assert.deepStrictEqual(parseSelection('0, 2, 99, x', 5), [2]);
  assert.deepStrictEqual(parseSelection('', 5), []);
});

test('CLI --dry-run lists folders and deletes nothing', () => {
  const root = workspace();
  const r = cli([root, '--dry-run']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /3 folders/);
  assert.match(r.out, /old-app/);
  assert.ok(fs.existsSync(path.join(root, 'old-app', 'node_modules')));
});

test('CLI --json prints valid JSON', () => {
  const root = workspace();
  const data = JSON.parse(cli([root, '--json']).out);
  assert.strictEqual(data.folders.length, 3);
  assert.strictEqual(data.totalBytes, 4700);
});

test('CLI --older-than 30 --all --yes deletes only old ones', () => {
  const root = workspace();
  const r = cli([root, '--older-than', '30', '--all', '--yes']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /Freed 3\.4 KB/);
  assert.strictEqual(fs.existsSync(path.join(root, 'old-app', 'node_modules')), false);
  assert.strictEqual(fs.existsSync(path.join(root, 'group', 'deep', 'node_modules')), false);
  assert.ok(fs.existsSync(path.join(root, 'new-app', 'node_modules')));
});

test('CLI --all without --yes cancels on "n"', () => {
  const root = workspace();
  const r = cli([root, '--all'], 'n\n');
  assert.match(r.out, /Cancelled/);
  assert.ok(fs.existsSync(path.join(root, 'old-app', 'node_modules')));
});

test('CLI --all accepts "y" typed ahead and deletes', () => {
  const root = workspace();
  const r = cli([root, '--all'], 'y\n');
  assert.match(r.out, /Freed/);
  assert.strictEqual(fs.existsSync(path.join(root, 'new-app', 'node_modules')), false);
});

test('CLI errors with exit 2 on bad input', () => {
  assert.strictEqual(cli(['/definitely/not/here']).code, 2);
  assert.strictEqual(cli(['--bogus']).code, 2);
  assert.strictEqual(cli(['--older-than', 'abc']).code, 2);
});

test('CLI reports a clean disk when nothing is found', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sweep-empty-'));
  assert.match(cli([empty]).out, /disk is clean/);
});
