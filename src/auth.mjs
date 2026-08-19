import { createInterface } from 'node:readline/promises';
import { saveToken, config, provider } from './config.mjs';
import { getAccount } from './api.mjs';
import { closeHttp } from './http.mjs';
import { log } from './notify.mjs';

// you sign in by hand; we only listen for the authorization header the page then sends
export async function authViaBrowser({ timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!provider.loginUrl) {
    throw new Error(`provider "${provider.name}" has no loginUrl; use \`--manual\` to paste a token.`);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('playwright not found. Install it:\n  npm install\n  npx playwright install chromium');
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  } catch (err) {
    throw new Error(`Chromium failed to start (${err.message}).\nRun: npx playwright install chromium`);
  }

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  let resolveToken;
  const tokenPromise = new Promise((resolve) => {
    resolveToken = resolve;
  });

  const onRequest = (req) => {
    const auth = req.headers()['authorization'];
    if (auth && /\/api\//.test(req.url())) resolveToken(auth);
  };
  page.on('request', onRequest);
  context.on('request', onRequest);

  log('info', `opening ${provider.loginUrl} - sign in in the browser window`);
  log('info', 'the token is picked up automatically after login and the window closes');
  await page.goto(provider.loginUrl, { waitUntil: 'domcontentloaded' });

  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('login not completed in time')), timeoutMs),
  );
  const closed = new Promise((_, reject) =>
    browser.on('disconnected', () => reject(new Error('browser window closed before login'))),
  );

  let token;
  try {
    token = await Promise.race([tokenPromise, timer, closed]);
  } finally {
    await browser.close().catch(() => {});
  }

  return token;
}

export async function authManual() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    '\nSign in in a browser, then F12 -> Network -> any request to /api/... ->' +
      ' Headers -> copy the Authorization value.\n',
  );
  const token = (await rl.question('Token: ')).trim();
  rl.close();
  if (!token) throw new Error('empty input.');
  return token;
}

export async function finishAuth(token) {
  config.token = token;
  const me = await getAccount(token);
  const path = saveToken(token, { name: me.name, id: me.id });
  await closeHttp();
  return { me, path };
}
