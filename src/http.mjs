import { Pool } from 'undici';
import { config, provider } from './config.mjs';
import { Limiter, fmtDuration } from './limiter.mjs';

const pool = new Pool(provider.origin, {
  connections: 2,
  pipelining: 0,
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  headersTimeout: 20_000,
  bodyTimeout: 20_000,
});

export const limiter = new Limiter({
  budget: config.checkBudget,
  windowMs: config.checkWindowMs,
  minIntervalMs: config.minRequestIntervalMs,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// requests go out one at a time - parallelism buys nothing under a budget this thin
let chain = Promise.resolve();

function serialize(fn) {
  const run = chain.then(fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export class RateLimited extends Error {
  constructor(retryAfterMs, scope) {
    super(`429: next attempt in ${fmtDuration(retryAfterMs)} (${scope})`);
    this.name = 'RateLimited';
    this.retryAfterMs = retryAfterMs;
    this.scope = scope;
  }
}

export class EdgeBlocked extends Error {
  constructor() {
    super('edge/CDN block: this IP is throttled. Raise MIN_REQUEST_INTERVAL_MS.');
    this.name = 'EdgeBlocked';
  }
}

function parseBody(raw, contentType) {
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return { _raw: raw };
    }
  }
  return { _raw: raw };
}

export async function request(method, path, { body, auth = null, retries = 2, counted = true } = {}) {
  const headers = { ...provider.headers(auth) };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const fullPath = path.startsWith(provider.apiBase) || path.startsWith('/api') ? path : provider.apiBase + path;

  for (let attempt = 0; ; attempt++) {
    // acquire outside the chain, otherwise a check sitting out a ban holds up a claim
    if (counted) await limiter.acquire();

    const res = await serialize(async () => {
      const r = await pool.request({
        method,
        path: fullPath,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await r.body.text();
      return { status: r.statusCode, headers: r.headers, raw };
    });

    if (provider.detectHardBlock?.(res.raw)) {
      if (counted) limiter.on429(5 * 60_000);
      throw new EdgeBlocked();
    }

    const parsed = parseBody(res.raw, res.headers['content-type']);

    if (res.status !== 429) {
      if (counted) limiter.onSuccess();
      return { status: res.status, headers: res.headers, body: parsed };
    }

    const retryAfterMs =
      (Number(parsed.retry_after) || Number(res.headers['retry-after']) || 1) * 1000 + 200;
    const scope = res.headers['x-ratelimit-scope'] ?? (parsed.global ? 'global' : 'bucket');
    if (counted) limiter.on429(retryAfterMs);

    // anything longer than a bucket refill is the caller's decision, not a silent sleep
    if (retryAfterMs > 5_000 || attempt >= retries) throw new RateLimited(retryAfterMs, scope);
    await sleep(retryAfterMs);
  }
}

// static path on purpose: pays the tls handshake without spending a check
export async function warmUp() {
  if (!provider.warmUpPath) return;
  try {
    await serialize(async () => {
      const r = await pool.request({
        method: 'GET',
        path: provider.warmUpPath,
        headers: provider.headers(null),
      });
      await r.body.text();
    });
  } catch {
    /* not critical */
  }
}

export async function closeHttp() {
  await pool.close();
}
