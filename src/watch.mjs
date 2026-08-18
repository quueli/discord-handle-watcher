import { config } from './config.mjs';
import { checkAvailability, claim, getAccount, explainClaim } from './api.mjs';
import { warmUp, closeHttp, limiter } from './http.mjs';
import { fmtDuration } from './limiter.mjs';
import { CheckState, ClaimState } from './states.mjs';
import { log, announce, countdown, status, endStatus } from './notify.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;

export async function watch(targets, { dryRun = config.dryRun, claimOnFree = config.claim } = {}) {
  if (!targets.length) {
    throw new Error('no targets. Set WATCH_TARGETS in .env or pass --targets abcd,efgh');
  }

  const willClaim = claimOnFree && !dryRun;
  if (willClaim) {
    const me = await getAccount();
    log('info', `account: ${me.name} (${me.id})`);
  } else {
    log('info', 'watch-only: targets are reported, not claimed');
  }

  log('info', `watching: ${targets.join(', ')}`);
  log('info', limiter.describe());

  // worth seeing up front: with many targets a free one can come and go between its own checks
  const secPerTarget = (limiter.windowMs / limiter.budget / 1000) * targets.length;
  log('info', `each target is checked about every ${fmtDuration(secPerTarget * 1000)}`);

  limiter.onWait = (ms, reason) => {
    if (ms >= 60_000) countdown(ms, reason);
  };
  await warmUp();

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('warn', 'stopping...');
  });

  const announced = new Set();
  let cycles = 0;
  let checks = 0;
  let errStreak = 0;
  const startedAt = Date.now();

  while (!stopping) {
    for (const name of targets) {
      if (stopping) break;
      let result;
      try {
        result = await checkAvailability(name);
      } catch (err) {
        endStatus();
        const wait = Math.min(BACKOFF_BASE_MS * 2 ** errStreak, BACKOFF_CAP_MS);
        errStreak++;
        log('warn', `${name}: ${err.message} (retry in ${fmtDuration(wait)})`);
        await sleep(wait);
        continue;
      }
      errStreak = 0;
      checks++;

      if (result.state === CheckState.RATE_LIMITED) {
        // the pause is already in the limiter, the next acquire() sits it out
        log('warn', `rate-limited (budget cut to ${limiter.budget})`);
        continue;
      }
      if (result.state === CheckState.AUTH_NEEDED) {
        log('bad', 'auth needed - run `npm run auth`');
        stopping = true;
        break;
      }
      if (result.state === CheckState.INVALID) {
        log('warn', `${name}: rejected as invalid (${result.detail}), dropping from list`);
        targets = targets.filter((t) => t !== name);
        continue;
      }
      if (result.state === CheckState.ERROR) {
        log('warn', `${name}: ${result.detail}`);
        continue;
      }

      const taken = result.state === CheckState.TAKEN;
      const state = taken ? '\x1b[31mTAKEN\x1b[0m' : '\x1b[32mAVAIL\x1b[0m';
      const mins = Math.round((Date.now() - startedAt) / 60000);
      status(
        `\x1b[90m[${clock()}]\x1b[0m ${name} -> ${state}  ` +
          `cycle ${cycles} - ${checks} checks - ${mins} min`,
      );
      if (taken) continue;

      if (!announced.has(name)) {
        endStatus();
        await announce('good', 'Target available', `**${name}** is free`);
        announced.add(name);
      }

      if (!willClaim) continue;

      const { state: claimState, detail, account } = await claim(name);
      const text = explainClaim(claimState, detail);
      if (claimState === ClaimState.SUCCESS) {
        await announce('good', 'Target claimed', `**${name}** - ${text}`, [
          { name: 'account', value: `${account?.name} (${account?.id})` },
        ]);
        stopping = true;
        break;
      }
      if (claimState === ClaimState.TAKEN) {
        announced.delete(name);
        await announce('warn', 'Claim missed', `**${name}**: ${text}`);
        continue;
      }
      await announce('bad', 'Claim stopped', `**${name}**: ${text}`);
      if (claimState === ClaimState.RATE_LIMITED) {
        await sleep((Number(detail?.retry_after) || 60) * 1000);
        announced.delete(name);
        continue;
      }
      stopping = true;
      break;
    }
    cycles++;
    if (!stopping) await sleep(config.cycleDelayMs);
  }

  endStatus();
  await closeHttp();
}
