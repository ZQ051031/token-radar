// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores the board with the model in lib/model.ts, and writes the
// entry's outputs: board.json, the dashboard's data.js, the dashboard and screenshots copied
// over, and dossier.json from the vendored make.fun library. The run is deterministic: the
// same snapshot bytes always write the same output bytes, so the grader's two runs agree.
//
//   node main.ts --input /input/snapshot.json            (in the grader's container)
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, checkBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap, and the caps the scorer applies to the screenshots and dashboard. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name value` or `--name=value` on the command line, or `fallback`. */
function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = checkBoard(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

/** Copy a directory tree of regular files into `to`, skipping dot-names and dot-directories. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const src = join(dir, entry.name);
      const dst = join(to, rel, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(dst, { recursive: true });
        walk(src, join(rel, entry.name));
      } else if (entry.isFile()) {
        copyFileSync(src, dst);
        copied.push(join(rel, entry.name));
      }
    }
  };
  walk(from, '');
  return copied.sort();
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashboardFiles = copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name.split('/').pop()!)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_LIMIT, dashboard: DASHBOARD_LIMIT }),
);

const multiples = Object.entries(radar.multiples.by_category)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3)
  .map(([c, m]) => `${c} ${m.toFixed(2)}x`)
  .join(', ');
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols in, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows out (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token-radar: overall market multiple ${radar.multiples.overall.toFixed(3)}x; dearest categories ${multiples}\n` +
    `token-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
