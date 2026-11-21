#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { scan, remove, formatBytes, formatAge, parseSelection } = require('../src/index');
const pkg = require('../package.json');

const HELP = `
node-sweep - find old node_modules folders and free disk space

Usage:
  node-sweep [folder] [options]       (folder defaults to the current one)

Options:
  -o, --older-than <days>   only show projects untouched for this many days
  -d, --depth <n>           how deep to search for projects   (default: 8)
      --all                 delete every folder found (asks once to confirm)
  -y, --yes                 skip the confirmation question (use with --all)
      --dry-run             show what would be deleted, delete nothing
      --json                print results as JSON, delete nothing
  -v, --version             print version
  -h, --help                print this help

Examples:
  node-sweep ~/projects
  node-sweep ~/projects --older-than 30
  node-sweep ~/projects --older-than 90 --all --yes
`;

const useColor = process.stdout.isTTY && !('NO_COLOR' in process.env);
const paint = (c) => (s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const red = paint(31), green = paint(32), yellow = paint(33), cyan = paint(36), dim = paint(2), bold = paint(1);

function fail(msg) {
  console.error(red(`Error: ${msg}`));
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { root: '.' };
  let rootSet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) fail(`${a} needs a non-negative number`);
      return v;
    };
    switch (a) {
      case '-o': case '--older-than': opts.olderThanDays = num(); break;
      case '-d': case '--depth': opts.maxDepth = num(); break;
      case '--all': opts.all = true; break;
      case '-y': case '--yes': opts.yes = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--json': opts.json = true; break;
      case '-v': case '--version': console.log(pkg.version); process.exit(0);
      case '-h': case '--help': console.log(HELP); process.exit(0);
      default:
        if (a.startsWith('-')) fail(`Unknown option: ${a}\nRun "node-sweep --help" for usage.`);
        if (rootSet) fail('Only one folder can be given.');
        opts.root = a;
        rootSet = true;
    }
  }
  return opts;
}

// One shared reader for every question, so typed-ahead answers are not lost.
let rl = null;
let lines = null;
async function ask(question) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    lines = rl[Symbol.asyncIterator]();
  }
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? '' : value;
}
function closeInput() {
  if (rl) rl.close();
}

function ageColor(days) {
  if (days >= 90) return red;
  if (days >= 30) return yellow;
  return green;
}

function printTable(results, root) {
  const numW = String(results.length).length;
  console.log(dim(`  ${'#'.padStart(numW)}  ${'SIZE'.padStart(9)}  ${'LAST TOUCHED'.padEnd(14)}  PROJECT`));
  results.forEach((r, i) => {
    const rel = path.relative(root, r.project) || '.';
    console.log(
      `  ${cyan(String(i + 1).padStart(numW))}  ${bold(formatBytes(r.size).padStart(9))}  ` +
      `${ageColor(r.ageDays)(formatAge(r.ageDays).padEnd(14))}  ${rel}`
    );
  });
}

function deleteMany(items) {
  let freed = 0;
  for (const r of items) {
    try {
      remove(r.path);
      freed += r.size;
      console.log(green('  ✔ deleted ') + r.path);
    } catch (err) {
      console.log(red('  ✖ failed  ') + r.path + dim(` (${err.message})`));
    }
  }
  return freed;
}

const sumSize = (items) => items.reduce((s, r) => s + r.size, 0);

async function confirm(question) {
  return /^y(es)?$/i.test((await ask(question)).trim());
}

// Returns the folders to delete, or null if the user cancelled.
async function chooseFolders(results, opts) {
  if (opts.all) {
    const ok = opts.yes || (await confirm(`Delete all ${results.length} folders (${formatBytes(sumSize(results))})? [y/N] `));
    return ok ? results : null;
  }
  const answer = await ask('Which ones to delete? (e.g. 1,3-5, "a" for all, Enter to cancel): ');
  const chosen = parseSelection(answer, results.length).map((n) => results[n - 1]);
  if (chosen.length === 0) return null;
  const ok = await confirm(`Delete ${chosen.length} folder(s), ${formatBytes(sumSize(chosen))}? [y/N] `);
  return ok ? chosen : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`Not a folder: ${root}`);

  if (!opts.json) console.log(dim(`Scanning ${root} ...\n`));
  const results = scan(root, opts);
  const total = sumSize(results);

  if (opts.json) {
    console.log(JSON.stringify({ root, totalBytes: total, folders: results }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(green('No node_modules folders found. Your disk is clean.'));
    return;
  }

  printTable(results, root);
  console.log(`\n  ${bold(results.length)} folders, ${bold(formatBytes(total))} total\n`);

  if (opts.dryRun) {
    console.log(dim('Dry run: nothing was deleted.'));
    return;
  }

  if (!opts.all && !process.stdin.isTTY) {
    console.log(dim('Not an interactive terminal: nothing deleted. Use --all --yes to delete.'));
    return;
  }

  const chosen = await chooseFolders(results, opts);
  if (!chosen) return console.log(dim('Cancelled. Nothing deleted.'));

  const freed = deleteMany(chosen);
  console.log(green(`\n🧹 Freed ${formatBytes(freed)}. Run "npm install" in a project to get it back.`));
}

main()
  .catch((err) => fail(err.message))
  .finally(closeInput);
