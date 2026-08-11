import { request } from './http.mjs';
import { config } from './config.mjs';

export class ApiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// per-account route, not the ip-limited signup one
export async function checkAvailability(target, { token = config.token } = {}) {
  if (!token) throw new ApiError('a token is required. Run `npm run auth`.');
  const { status, body } = await request('POST', '/users/@me/pomelo-attempt', {
    body: { username: String(target).toLowerCase() },
    auth: token,
  });
  if (status === 200 && typeof body.taken === 'boolean') return !body.taken;
  if (status === 401) throw new ApiError('token rejected', { status });
  throw new ApiError(`unexpected ${status}`, { status });
}

export async function getAccount({ token = config.token } = {}) {
  if (!token) throw new ApiError('no token. Run `npm run auth`.');
  const { status, body } = await request('GET', '/users/@me', { auth: token });
  if (status === 200) return { id: body.id, name: body.username };
  throw new ApiError(`account request returned ${status}`, { status });
}
