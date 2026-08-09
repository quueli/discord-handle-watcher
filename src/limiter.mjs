import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './config.mjs';

const DEFAULT_STATE_FILE = join(DATA_DIR, 'ratelimit.json');
const MAX_WINDOW_MS = 6 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Limiter {
  constructor({
    budget = 15,
    windowMs = 30 * 60 * 1000,
    minIntervalMs = 900,
    budgetMax = 40,
    stateFile = DEFAULT_STATE_FILE,
  } = {}) {
    this.stateFile = stateFile;
    this.minIntervalMs = minIntervalMs;
    this.budgetMax = budgetMax;
    this.onWait = null;

    const saved = this.#load();
    this.budget = saved.budget ?? budget;
    this.windowMs = saved.windowMs ?? windowMs;
    this.blockedUntil = saved.blockedUntil ?? 0;
    this.ceiling = saved.ceiling ?? null;
    // filter against the saved window, not the default one, or a restart wipes the stretch
    this.history = (saved.history ?? []).filter((t) => Date.now() - t < this.windowMs);
    this.okStreak = 0;
    this.sinceBan = 0;
    this.lastRequestAt = 0;
  }

  #load() {
    if (!existsSync(this.stateFile)) return {};
    try {
      return JSON.parse(readFileSync(this.stateFile, 'utf8'));
    } catch {
      return {};
    }
  }

  #save() {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(
      this.stateFile,
      JSON.stringify(
        {
          budget: this.budget,
          ceiling: this.ceiling,
          windowMs: this.windowMs,
          blockedUntil: this.blockedUntil,
          history: this.history,
        },
        null,
        2,
      ),
    );
  }

  #prune() {
    const cutoff = Date.now() - this.windowMs;
    this.history = this.history.filter((t) => t > cutoff);
  }

  remaining() {
    this.#prune();
    return Math.max(0, this.budget - this.history.length);
  }

  availableAt() {
    if (Date.now() < this.blockedUntil) return this.blockedUntil;
    this.#prune();
    if (this.history.length < this.budget) return 0;
    return this.history[0] + this.windowMs;
  }

  pace() {
    return Math.max(this.minIntervalMs, Math.floor(this.windowMs / Math.max(this.budget, 1)));
  }

  #wait(untilTs, reason) {
    const ms = untilTs - Date.now();
    if (ms <= 0) return Promise.resolve();
    this.onWait?.(ms, reason);
    return sleep(ms);
  }

  async acquire() {
    if (Date.now() < this.blockedUntil) {
      // history stays: the window outlives the ban, the request after a 26m one caught a 36m
      await this.#wait(this.blockedUntil, 'rate-limit ban');
    }
    for (;;) {
      this.#prune();
      if (this.history.length < this.budget) break;
      await this.#wait(this.history[0] + this.windowMs + 100, 'window budget spent');
    }
    const gap = this.lastRequestAt + this.pace() - Date.now();
    if (gap > 0) {
      if (gap > 30_000) this.onWait?.(gap, 'even pacing');
      await sleep(gap);
    }

    this.lastRequestAt = Date.now();
    this.history.push(this.lastRequestAt);
    this.#save();
  }

  // once a long 429 is seen, stop growing well below the budget that earned it
  growthCap() {
    if (!this.ceiling) return this.budgetMax;
    return Math.max(2, Math.floor(this.ceiling * 0.75));
  }

  onSuccess() {
    this.okStreak++;
    this.sinceBan++;
    // step scales with the budget: at 3 req/hour a flat 20 successes is most of a day
    const step = Math.max(5, Math.ceil(this.budget / 2));
    if (this.okStreak >= step && this.budget < this.growthCap()) {
      this.budget++;
      this.okStreak = 0;
      this.#save();
    }
  }

  on429(retryAfterMs) {
    const successesSinceBan = this.sinceBan;
    this.okStreak = 0;
    this.sinceBan = 0;
    this.blockedUntil = Date.now() + retryAfterMs;

    // short ones are ordinary buckets, not a wall
    if (retryAfterMs > 30_000) {
      this.ceiling = this.ceiling ? Math.min(this.ceiling, this.budget) : this.budget;
      this.budget = Math.max(2, Math.floor(this.budget / 2));
      // ban -> 1 req -> ban again: not the budget, the window estimate itself is too short
      if (successesSinceBan <= 5 && this.windowMs < MAX_WINDOW_MS) {
        this.windowMs = Math.min(this.windowMs * 2, MAX_WINDOW_MS);
      }
    }
    this.#save();
  }

  describe() {
    const left = this.availableAt() - Date.now();
    const wait = left > 0 ? `, wait ${fmtDuration(left)}` : '';
    const win =
      this.windowMs >= 60_000
        ? `${Math.round(this.windowMs / 60_000)}m`
        : `${Math.round(this.windowMs / 1000)}s`;
    const roof = this.ceiling ? `, ceiling ${this.growthCap()}` : '';
    return `budget ${this.remaining()}/${this.budget} per ${win}${roof}${wait}`;
  }
}

export function fmtDuration(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m ${s % 60}s`;
}
