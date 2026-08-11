import { CheckState } from '../states.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

export const discord = {
  name: 'discord',
  origin: 'https://discord.com',
  apiBase: '/api/v9',
  checkNeedsToken: true,

  headers(token) {
    const h = { accept: '*/*', 'user-agent': UA, origin: this.origin };
    if (token) h.authorization = token;
    return h;
  },

  validateTarget(name) {
    const n = String(name).toLowerCase();
    if (!USERNAME_RE.test(n)) return `"${name}": only a-z 0-9 _ . allowed, length 2-32`;
    if (n.includes('..')) return `"${name}": two dots in a row are not allowed`;
    if (n.startsWith('.') || n.endsWith('.')) return `"${name}": a leading/trailing dot is not allowed`;
    return null;
  },

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
    return { state: CheckState.ERROR, detail: `unexpected ${status}` };
  },

  accountRequest() {
    return { method: 'GET', path: '/users/@me' };
  },

  parseAccount(body) {
    return { id: body.id, name: body.username };
  },
};
