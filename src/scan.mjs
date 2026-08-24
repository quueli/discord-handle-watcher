import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { checkAvailability } from './api.mjs';
import { warmUp, closeHttp, limiter } from './http.mjs';
import { fmtDuration } from './limiter.mjs';
import { CheckState } from './states.mjs';
import { log, announce, countdown, checked } from './notify.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadChecked(csvPath) {
  if (!existsSync(csvPath)) return new Map();
  const map = new Map();
  for (const line of readFileSync(csvPath, 'utf8').split('\n')) {
    const [name, taken] = line.split(',');
    if (name && name !== 'target') map.set(name, taken === 'true');
  }
  return map;
}

function fmtEta(ms) {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

// results are appended line by line so ctrl+c and the same command again continues the scan
export async function scan(names, { out = 'scan.csv', resume = true, onFree = null } = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const csvPath = join(DATA_DIR, out);
  const already = resume ? loadChecked(csvPath) : new Map();
  if (!existsSync(csvPath)) appendFileSync(csvPath, 'target,taken,checked_at\n');

  const queue = names.filter((n) => !already.has(n));
  const free = [...already].filter(([, taken]) => !taken).map(([n]) => n);

  log('info', `${queue.length} to check (${already.size} done, ${free.length} available)`);
  log('info', `results: ${csvPath}`);
  log('info', limiter.describe());
  if (queue.length === 0) return { free, checked: already.size };

  const perHour = (limiter.budget / limiter.windowMs) * 3_600_000;
  log('info', `~${perHour.toFixed(0)} checks/hour -> ${fmtEta((queue.length / perHour) * 3_600_000)} for the list`);

  limiter.onWait = (ms, reason) => {
    if (ms >= 60_000) countdown(ms, reason);
  };
  await warmUp();

  let stopping = false;
  const onSig = () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('warn', 'stopping, progress saved - run the same command to continue');
  };
  process.on('SIGINT', onSig);

  const t0 = Date.now();
  const retried = new Map();
  let done = 0;

  for (const name of queue) {
    if (stopping) break;
    const result = await checkAvailability(name).catch((err) => ({ state: CheckState.ERROR, detail: err.message }));

    if (result.state === CheckState.RATE_LIMITED) {
      // back of the queue, the next acquire() waits the pause out
      const tries = (retried.get(name) ?? 0) + 1;
      retried.set(name, tries);
      if (tries <= 3) queue.push(name);
      else log('bad', `${name}: three 429s in a row, skipping`);

      if ((result.retryAfterMs ?? 0) > 30_000) {
        log('warn', `rate-limited (budget cut to ${limiter.budget} per ${fmtDuration(limiter.windowMs)})`);
      } else {
        log('info', `bucket full, pausing ${fmtDuration(result.retryAfterMs ?? 1000)}`);
      }
      continue;
    }
    if (result.state === CheckState.AUTH_NEEDED) {
      log('bad', 'auth needed - run `npm run auth`');
      break;
    }
    if (result.state === CheckState.INVALID) {
      appendFileSync(csvPath, `${name},invalid,${new Date().toISOString()}\n`);
      log('warn', `${name}: rejected as invalid, skipping`);
      continue;
    }
    if (result.state === CheckState.ERROR) {
      log('warn', `${name}: ${result.detail}`);
      await sleep(2000);
      continue;
    }

    const taken = result.state === CheckState.TAKEN;
    appendFileSync(csvPath, `${name},${taken},${new Date().toISOString()}\n`);
    done++;
    checked(name, taken);
    if (!taken) {
      free.push(name);
      if (onFree) {
        if ((await onFree(name)) === 'stop') {
          stopping = true;
          break;
        }
      } else {
        await announce('good', 'Available target', `**${name}** is free`, [
          { name: 'watch', value: `npm run watch -- --targets ${name}` },
        ]);
      }
    }
    if (done % 50 === 0 || done === queue.length) {
      const rate = done / ((Date.now() - t0) / 3_600_000);
      const eta = ((queue.length - done) / rate) * 3_600_000;
      log('info', `${done}/${queue.length}  ${rate.toFixed(0)}/hour  ~${fmtEta(eta)} left  available: ${free.length}`);
    }
  }

  process.off('SIGINT', onSig);
  await closeHttp();

  log('good', `done. available found: ${free.length}`);
  if (free.length) console.log('\n' + free.join('\n') + '\n');
  return { free, checked: already.size + done };
}
