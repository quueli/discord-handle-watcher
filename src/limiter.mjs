const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Limiter {
  constructor({ minIntervalMs = 900 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.lastRequestAt = 0;
    this.onWait = null;
  }

  async acquire() {
    const gap = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (gap > 0) {
      this.onWait?.(gap, 'fixed delay');
      await sleep(gap);
    }
    this.lastRequestAt = Date.now();
  }

  onSuccess() {}
  on429() {}

  describe() {
    return `fixed delay ${this.minIntervalMs} ms between requests`;
  }
}

export function fmtDuration(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
