#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { config, validateTarget } from '../src/config.mjs';
import { log } from '../src/notify.mjs';

const argv = process.argv.slice(2);
const command = argv[0];

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const f = flags(argv.slice(1));

function usage() {
  console.log(`
\x1b[1mhandle-watcher\x1b[0m - poll a rate-limited API for target availability

  \x1b[36mnpm run auth\x1b[0m                    one-time interactive login, stores a token
    --manual                       paste a token instead of using the browser

  \x1b[36mnpm run probe\x1b[0m                   preflight: provider, latency, token, config

  \x1b[36mnpm run scan\x1b[0m -- [options]        bulk-check which targets are available
    --pattern cvcv                 candidate pattern (see \`npm run gen\`)
    --file data/list.txt           your own list, one target per line
    --targets abcd,efgh            explicit comma-separated list
    --limit 500                    check only the first N
    --seed 42                      shuffle the list (not alphabetical)
    --out scan.csv                 where to write results (under data/)
    --fresh                        ignore a previous scan, start over

  \x1b[36mnpm run watch\x1b[0m -- [options]       watch targets and report availability
    --targets abcd,efgh            targets (else from WATCH_TARGETS in .env)
    --claim                        also attempt to claim (optional, off by default)
    --live                         disable dry-run

  \x1b[36mnpm run gen\x1b[0m -- [options]         list patterns / dump a candidate list
    --pattern cvcv --limit 50

Settings live in .env (template: .env.example).
`);
}

function parseTargets(raw) {
  const list = String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const problems = list.map(validateTarget).filter(Boolean);
  if (problems.length) {
    for (const p of problems) log('bad', p);
    process.exit(1);
  }
  return list;
}

async function collectNames(defaultPattern = 'cvcv') {
  if (f.targets) return parseTargets(f.targets);

  if (f.file) {
    const raw = readFileSync(f.file, 'utf8')
      .split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const good = raw.filter((n) => validateTarget(n) === null);
    if (good.length !== raw.length) {
      log('warn', `${raw.length - good.length} lines dropped as invalid targets`);
    }
    return good;
  }

  const { generate } = await import('../src/gen.mjs');
  return generate(f.pattern ?? defaultPattern, {
    limit: f.limit ? Number(f.limit) : Infinity,
    seed: f.seed !== undefined ? Number(f.seed) : null,
  });
}

try {
  switch (command) {
    case 'auth': {
      const { authViaBrowser, authManual, finishAuth } = await import('../src/auth.mjs');
      const token = f.manual ? await authManual() : await authViaBrowser();
      const { me, path } = await finishAuth(token);
      log('good', `signed in as ${me.name} (${me.id})`);
      log('info', `token saved: ${path}`);
      break;
    }

    case 'probe': {
      const { probe } = await import('../src/probe.mjs');
      process.exitCode = (await probe()) > 0 ? 1 : 0;
      break;
    }

    case 'scan': {
      const { scan } = await import('../src/scan.mjs');
      const names = await collectNames();
      await scan(names, { out: f.out ?? 'scan.csv', resume: !f.fresh });
      break;
    }

    case 'watch': {
      const { watch } = await import('../src/watch.mjs');
      const targets = f.targets ? parseTargets(f.targets) : config.targets;
      await watch(targets, {
        dryRun: f.live ? false : config.dryRun,
        claimOnFree: f.claim ? true : config.claim,
      });
      break;
    }

    case 'gen': {
      const { PATTERNS, generate } = await import('../src/gen.mjs');
      if (!f.pattern) {
        console.log('\nPatterns:\n');
        for (const [name, p] of Object.entries(PATTERNS)) {
          console.log(`  \x1b[36m${name.padEnd(9)}\x1b[0m ${p.desc}`);
        }
        console.log('');
        break;
      }
      const list = generate(f.pattern, {
        limit: f.limit ? Number(f.limit) : 100,
        seed: f.seed !== undefined ? Number(f.seed) : null,
      });
      console.log(list.join('\n'));
      break;
    }

    default:
      usage();
      process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  log('bad', err.message);
  process.exitCode = 1;
}
