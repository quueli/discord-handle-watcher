import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
const ENV_FILE = join(ROOT, '.env');

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

export const config = {
  token: process.env.API_TOKEN?.trim() || null,
  targets: (process.env.WATCH_TARGETS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  dryRun: bool(process.env.DRY_RUN, true),
  minRequestIntervalMs: int(process.env.MIN_REQUEST_INTERVAL_MS, 900),
  cycleDelayMs: int(process.env.CYCLE_DELAY_MS, 1500),
};

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;

export function validateTarget(name) {
  const n = String(name).toLowerCase();
  if (!USERNAME_RE.test(n)) return `"${name}": only a-z 0-9 _ . allowed, length 2-32`;
  if (n.includes('..')) return `"${name}": two dots in a row are not allowed`;
  if (n.startsWith('.') || n.endsWith('.')) return `"${name}": a leading/trailing dot is not allowed`;
  return null;
}
