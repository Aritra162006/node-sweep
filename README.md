# node-sweep

Find old `node_modules` folders, see how much space each one uses, and delete the ones you pick. Zero dependencies.

```
$ npx node-sweep ~/projects

Scanning /home/you/projects ...

  #       SIZE  LAST TOUCHED    PROJECT
  1   412.3 MB  today           chat-app
  2   298.0 MB  6 months ago    old-portfolio
  3   187.5 MB  1 month ago     hackathon/api

  3 folders, 897.8 MB total

Which ones to delete? (e.g. 1,3-5, "a" for all, Enter to cancel): 2,3
Delete 2 folder(s), 485.5 MB? [y/N] y

  ✔ deleted /home/you/projects/old-portfolio/node_modules
  ✔ deleted /home/you/projects/hackathon/api/node_modules

🧹 Freed 485.5 MB. Run "npm install" in a project to get it back.
```

## Why

Every Node project carries its own `node_modules` folder, often hundreds of MB. Old tutorials, hackathons and college assignments quietly eat gigabytes. Deleting `node_modules` is safe: your code stays, and `npm install` brings the packages back.

## Install

Requires Node.js 18 or newer.

```bash
npx node-sweep            # run without installing
npm i -g node-sweep       # or install globally, then run `node-sweep`
```

## Usage

```bash
npx node-sweep                         # scan the current folder
npx node-sweep ~/projects              # scan a specific folder
npx node-sweep ~/projects -o 30        # only projects untouched for 30+ days
npx node-sweep ~/projects --dry-run    # just show, never delete
npx node-sweep ~/projects -o 90 --all --yes   # delete all old ones, no questions
```

| Option | What it does |
|---|---|
| `-o, --older-than <days>` | Only show projects not changed for this many days |
| `-d, --depth <n>` | How deep to search for projects (default 8) |
| `--all` | Delete every folder found (asks once) |
| `-y, --yes` | Skip the confirmation (use with `--all`) |
| `--dry-run` | Show what would be deleted, delete nothing |
| `--json` | Print results as JSON, delete nothing |
| `-v, --version` / `-h, --help` | Version / help |

`--json` prints `{ root, totalBytes, folders: [{ path, project, size, modified, ageDays }] }`. Exit code is 0 on success or cancel, and 2 for bad arguments or a missing folder. A failed deletion is reported but still exits 0. Colors are off when `NO_COLOR` is set.

Selection accepts single numbers, lists and ranges: `1`, `1,4`, `2-5`, `a` for all.

**"Last touched"** is the newest modification time of the entries directly inside the project folder (`package.json`, `src/`, and so on; `node_modules` is ignored). Edits deep inside subfolders may not count.

## Safety

- Deletes **only** folders named exactly `node_modules`, and refuses anything else even if asked.
- Always asks before deleting, unless you pass `--all --yes`. In a non-interactive shell (piped, CI) it only lists folders unless you pass `--all`.
- Deleted folders are removed permanently, not moved to the Trash. Try `--dry-run` first.
- Doesn't follow symlinks. Skips `.git`, `.hg`, `.svn`, `.cache`, `.Trash` and `Library` folders, and folders it isn't allowed to read.
- Nested `node_modules` are counted inside their parent, not listed twice.

## Use it from code

```js
const { scan, remove, formatBytes } = require('node-sweep');

const old = scan('/home/me/projects', { olderThanDays: 60 });
for (const f of old) {
  console.log(formatBytes(f.size), f.project);
  // remove(f.path);
}
```

`scan` is synchronous. Each result is `{ path, project, size, modified (a Date), ageDays }`, biggest first.

## License

MIT
