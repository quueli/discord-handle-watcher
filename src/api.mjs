import { request, RateLimited, EdgeBlocked } from './http.mjs';
import { config, provider } from './config.mjs';
import { CheckState, ClaimState } from './states.mjs';

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function checkAvailability(target) {
  if (provider.checkNeedsToken && !config.token) {
    throw new ApiError('a token is required for the check route. Run `npm run auth`.');
  }
  const req = provider.checkRequest(target);
  try {
    const res = await request(req.method, req.path, { body: req.body, auth: config.token });
    return provider.interpretCheck(res);
  } catch (err) {
    if (err instanceof RateLimited) {
      return { state: CheckState.RATE_LIMITED, detail: err.message, retryAfterMs: err.retryAfterMs };
    }
    if (err instanceof EdgeBlocked) {
      return { state: CheckState.RATE_LIMITED, detail: err.message, retryAfterMs: 5 * 60_000 };
    }
    throw err;
  }
}

export async function getAccount(token = config.token) {
  if (!token) throw new ApiError('no token. Run `npm run auth`.');
  // uncounted: this route has its own bucket, no reason to sit out the check route's ban
  const req = provider.accountRequest();
  const res = await request(req.method, req.path, { auth: token, counted: false });
  if (res.status === 200) return provider.parseAccount(res.body);
  if (res.status === 401) {
    throw new ApiError('token invalid or expired. Run `npm run auth`.', res);
  }
  throw new ApiError(`account request returned ${res.status}`, res);
}

export async function claim(target) {
  if (!config.token) throw new ApiError('no token. Run `npm run auth`.');
  if (provider.claimNeedsSecret && !config.secret) {
    throw new ApiError('this provider needs API_SECRET set to claim.');
  }
  const req = provider.claimRequest(target, config.secret);
  try {
    const res = await request(req.method, req.path, {
      body: req.body,
      auth: config.token,
      retries: 0,
      counted: false,
    });
    return provider.interpretClaim(res);
  } catch (err) {
    if (err instanceof RateLimited) return { state: ClaimState.RATE_LIMITED, detail: err.message };
    throw err;
  }
}

export function explainClaim(state, detail) {
  switch (state) {
    case ClaimState.SUCCESS:
      return 'claimed';
    case ClaimState.TAKEN:
      return 'someone else took it first';
    case ClaimState.CHALLENGE:
      return 'the provider wants a challenge (captcha); finish it by hand in the client';
    case ClaimState.AUTH_NEEDED:
      return 'auth rejected: check API_TOKEN / API_SECRET';
    case ClaimState.RATE_LIMITED:
      return `claim rate-limited, retry in ~${Math.ceil(Number(detail?.retry_after) || 0)}s`;
    default:
      return `unexpected response: ${JSON.stringify(detail).slice(0, 300)}`;
  }
}
