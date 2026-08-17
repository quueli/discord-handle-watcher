import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discord } from './providers/discord.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SECRETS_DIR = join(ROOT, '.secrets');
export const DATA_DIR = join(ROOT, 'data');
const TOKEN_FILE = join(SECRETS_DIR, 'token.json');
const ENV_FILE = join(ROOT, '.env');

// node >=20.12 reads .env without a dependency
if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (err) {
    console.error(`could not read .env: ${err.message}`);
  }
}

const bool = (v, dflt) => (v === undefined ? dflt : /^(1|true|yes|on)$/i.test(String(v).trim()));
const int = (v, dflt) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

const PROVIDERS = { discord };
const providerName = (process.env.PROVIDER || 'discord').trim().toLowerCase();

export const provider = PROVIDERS[providerName];
if (!provider) {
  throw new Error(`unknown PROVIDER "${providerName}", known: ${Object.keys(PROVIDERS).join(', ')}`);
}

function readToken() {
  if (process.env.API_TOKEN?.trim()) return process.env.API_TOKEN.trim();
  if (existsSync(TOKEN_FILE)) {
    try {
      return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export function saveToken(token, meta = {}) {
  mkdirSync(SECRETS_DIR, { recursive: true });
  writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ token, savedAt: new Date().toISOString(), ...meta }, null, 2),
    { mode: 0o600 },
  );
  return TOKEN_FILE;
}

export const config = {
  token: readToken(),
  secret: process.env.API_SECRET?.trim() || null,
  targets: (process.env.WATCH_TARGETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  dryRun: bool(process.env.DRY_RUN, true),
  claim: bool(process.env.CLAIM, false),
  minRequestIntervalMs: int(process.env.MIN_REQUEST_INTERVAL_MS, 900),
  cycleDelayMs: int(process.env.CYCLE_DELAY_MS, 1500),
  checkBudget: int(process.env.CHECK_BUDGET, 30),
  checkWindowMs: int(process.env.CHECK_WINDOW_SEC, 60) * 1_000,
  webhookUrl: process.env.WEBHOOK_URL?.trim() || null,
  beep: bool(process.env.BEEP, true),
  tokenFile: TOKEN_FILE,
};

export function validateTarget(name) {
  return provider.validateTarget(name);
}
