import { config, provider, validateTarget } from './config.mjs';
import { checkAvailability, getAccount } from './api.mjs';
import { warmUp, closeHttp, limiter } from './http.mjs';
import { fmtDuration } from './limiter.mjs';
import { CheckState } from './states.mjs';
import { log, countdown } from './notify.mjs';

const ok = (m) => console.log(`  \x1b[32m[ok]\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m[!!]\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m[..]\x1b[0m ${m}`);

export async function probe({ skipNetwork = false } = {}) {
  let failures = 0;
  limiter.onWait = (ms, reason) => countdown(ms, reason);

  console.log(`\n\x1b[1mProvider\x1b[0m`);
  ok(`${provider.name} (${provider.origin}${provider.apiBase})`);

  console.log('\n\x1b[1mLimits\x1b[0m');
  ok(limiter.describe());
  const blockedFor = limiter.availableAt() - Date.now();
  if (blockedFor > 0) {
    warn(`paused for another ${fmtDuration(blockedFor)} - skipping network checks`);
    skipNetwork = true;
  }

  console.log('\n\x1b[1mNetwork\x1b[0m');
  const t = Date.now();
  await warmUp();
  ok(`connection warmed in ${Date.now() - t} ms (no request spent)`);

  if (!skipNetwork) {
    console.log('\n\x1b[1mCheck route\x1b[0m');
    const freeName = 'zq' + Math.random().toString(36).slice(2, 12) + 'xv';
    if (validateTarget(freeName)) {
      warn('could not build a throwaway target for this provider, skipping the live check');
    } else {
      const result = await checkAvailability(freeName).catch((err) => ({ state: CheckState.ERROR, detail: err.message }));
      if (result.state === CheckState.AVAILABLE) ok(`"${freeName}" -> available (as expected)`);
      else {
        bad(`"${freeName}" -> ${result.state} ${result.detail ?? ''} - response semantics changed?`);
        failures++;
      }
    }
  }

  console.log('\n\x1b[1mConfig\x1b[0m');
  if (config.targets.length) {
    ok(`targets: ${config.targets.length} (${config.targets.join(', ')})`);
    for (const target of config.targets) {
      const problem = validateTarget(target);
      if (problem) {
        bad(problem);
        failures++;
      }
    }
  } else {
    warn('WATCH_TARGETS empty - set targets in .env or pass --targets');
  }

  if (config.minRequestIntervalMs < 700) {
    warn(`MIN_REQUEST_INTERVAL_MS=${config.minRequestIntervalMs} - risks an edge/CDN block`);
  } else {
    ok(`request interval ${config.minRequestIntervalMs} ms`);
  }

  console.log('\n\x1b[1mAuth\x1b[0m');
  if (config.token) {
    try {
      const me = await getAccount();
      ok(`token works: ${me.name} (${me.id})`);
    } catch (err) {
      bad(err.message);
      failures++;
    }
  } else {
    warn('no token - run `npm run auth` (not required for scan on a token-less provider)');
  }

  if (provider.claimNeedsSecret) {
    if (config.secret) ok('API_SECRET is set');
    else warn('API_SECRET empty - claiming will not work without it');
  }

  console.log(
    config.claim && !config.dryRun
      ? '\n  \x1b[31mCLAIM=true, DRY_RUN=false\x1b[0m - the tool will attempt to claim'
      : '\n  \x1b[33mwatch-only\x1b[0m - targets are reported, not claimed',
  );

  await closeHttp();
  if (failures) log('bad', `problems: ${failures}`);
  else log('good', 'ready');
  return failures;
}
