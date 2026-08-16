import { CheckState, ClaimState } from '../states.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

// the web client sends this build number in its own headers; some routes answer 400 without it
const CLIENT_BUILD_NUMBER = Number.parseInt(process.env.CLIENT_BUILD_NUMBER ?? '', 10) || 354600;

function superProperties() {
  return Buffer.from(
    JSON.stringify({
      os: 'Windows',
      browser: 'Chrome',
      device: '',
      system_locale: 'en-US',
      browser_user_agent: UA,
      browser_version: '131.0.0.0',
      os_version: '10',
      referrer: '',
      referring_domain: '',
      referrer_current: '',
      referring_domain_current: '',
      release_channel: 'stable',
      client_build_number: CLIENT_BUILD_NUMBER,
      client_event_source: null,
    }),
  ).toString('base64');
}

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

export const discord = {
  name: 'discord',
  origin: 'https://discord.com',
  apiBase: '/api/v9',
  warmUpPath: '/robots.txt',
  loginUrl: 'https://discord.com/login',

  checkNeedsToken: true,
  claimNeedsSecret: true,

  headers(token) {
    const h = {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': UA,
      origin: this.origin,
      referer: `${this.origin}/channels/@me`,
      'x-discord-locale': 'en-US',
      'x-debug-options': 'bugReporterEnabled',
      'x-super-properties': superProperties(),
    };
    if (token) h.authorization = token;
    return h;
  },

  // the edge layer reports a hard IP block in the body, with a 200-ish status
  detectHardBlock(raw) {
    return typeof raw === 'string' && raw.includes('error code: 1015');
  },

  validateTarget(name) {
    const n = String(name).toLowerCase();
    if (!USERNAME_RE.test(n)) return `"${name}": only a-z 0-9 _ . allowed, length 2-32`;
    if (n.includes('..')) return `"${name}": two dots in a row are not allowed`;
    if (n.startsWith('.') || n.endsWith('.')) return `"${name}": a leading/trailing dot is not allowed`;
    return null;
  },

  // the route the client hits while you type in "change username", limited per account.
  // the signup-form one (username-attempt-unauthed) is per IP: ~20 requests, then 26 minutes
  checkRequest(target) {
    return {
      method: 'POST',
      path: '/users/@me/pomelo-attempt',
      body: { username: String(target).toLowerCase() },
    };
  },

  interpretCheck({ status, body }) {
    if (status === 200 && typeof body.taken === 'boolean') {
      return { state: body.taken ? CheckState.TAKEN : CheckState.AVAILABLE };
    }
    if (status === 401) return { state: CheckState.AUTH_NEEDED, detail: 'token rejected' };
    if (status === 400) return { state: CheckState.INVALID, detail: JSON.stringify(body).slice(0, 300) };
    return { state: CheckState.ERROR, detail: `unexpected ${status}: ${JSON.stringify(body).slice(0, 300)}` };
  },

  accountRequest() {
    return { method: 'GET', path: '/users/@me' };
  },

  parseAccount(body) {
    return { id: body.id, name: body.username, raw: body };
  },

  claimRequest(target, secret) {
    return {
      method: 'PATCH',
      path: '/users/@me',
      body: { username: String(target).toLowerCase(), password: secret },
    };
  },

  interpretClaim({ status, body }) {
    if (status === 200) return { state: ClaimState.SUCCESS, account: this.parseAccount(body), detail: body };
    if (status === 401) return { state: ClaimState.AUTH_NEEDED, detail: body };
    if (status === 429) return { state: ClaimState.RATE_LIMITED, detail: body };
    if (body?.captcha_key || body?.captcha_service) {
      return { state: ClaimState.CHALLENGE, detail: body };
    }
    const fieldErrors = body?.errors ?? {};
    if (/USERNAME_TAKEN|already taken/i.test(JSON.stringify(fieldErrors))) {
      return { state: ClaimState.TAKEN, detail: body };
    }
    if (fieldErrors.password) return { state: ClaimState.AUTH_NEEDED, detail: body };
    return { state: ClaimState.UNKNOWN, detail: body };
  },
};
