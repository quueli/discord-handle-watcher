import { request as undiciRequest } from 'undici';
import { config } from './config.mjs';
import { Limiter, fmtDuration } from './limiter.mjs';

const ORIGIN = 'https://discord.com';
const API = '/api/v9';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

export const limiter = new Limiter({ minIntervalMs: config.minRequestIntervalMs });

export class RateLimited extends Error {
  constructor(retryAfterMs) {
    super(`429: next attempt in ${fmtDuration(retryAfterMs)}`);
    this.name = 'RateLimited';
    this.retryAfterMs = retryAfterMs;
  }
}

export async function request(method, path, { body, auth } = {}) {
  await limiter.acquire();

  const headers = { accept: '*/*', 'user-agent': UA, origin: ORIGIN };
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const r = await undiciRequest(ORIGIN + API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await r.body.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { _raw: raw };
  }

  if (r.statusCode === 429) {
    const retryAfterMs = (Number(parsed.retry_after) || 1) * 1000 + 200;
    throw new RateLimited(retryAfterMs);
  }
  return { status: r.statusCode, headers: r.headers, body: parsed };
}

export async function closeHttp() {}
