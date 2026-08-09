import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Limiter, fmtDuration } from '../src/limiter.mjs';

// tiny windows on purpose: pace is window/budget, a realistic one would wait minutes
function withTempLimiter(opts, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hw-test-'));
  try {
    return fn((extra = {}) => new Limiter({ stateFile: join(dir, 'rl.json'), ...opts, ...extra }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('budget is spent one request at a time', async () => {
  await withTempLimiter({ budget: 3, windowMs: 3_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    assert.equal(lim.remaining(), 3);
    await lim.acquire();
    await lim.acquire();
    assert.equal(lim.remaining(), 1);
  });
});

test('spent budget waits out the window', async () => {
  await withTempLimiter({ budget: 2, windowMs: 2_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    await lim.acquire();
    await lim.acquire();
    assert.equal(lim.remaining(), 0);
    const waitMs = lim.availableAt() - Date.now();
    assert.ok(waitMs > 0 && waitMs <= 2_000, `expected the rest of the window, got ${waitMs} ms`);
  });
});

test('a 429 halves the budget and sets a pause', async () => {
  await withTempLimiter({ budget: 16, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(1_567_000);
    assert.equal(lim.budget, 8);
    const left = lim.availableAt() - Date.now();
    assert.ok(left > 1_560_000, `pause should be ~26 min, got ${left} ms`);
  });
});

test('a short 429 leaves the budget alone', async () => {
  await withTempLimiter({ budget: 16, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(2_000);
    assert.equal(lim.budget, 16);
  });
});

test('budget regrows in steps relative to itself', async () => {
  await withTempLimiter({ budget: 3, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 4; i++) lim.onSuccess();
    assert.equal(lim.budget, 3);
    lim.onSuccess();
    assert.equal(lim.budget, 4);
  });
});

test('a large budget grows slower than a small one', async () => {
  await withTempLimiter({ budget: 20, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 9; i++) lim.onSuccess();
    assert.equal(lim.budget, 20);
    lim.onSuccess();
    assert.equal(lim.budget, 21);
  });
});

test('budget stops at budgetMax', async () => {
  await withTempLimiter({ budget: 39, windowMs: 60_000, minIntervalMs: 0, budgetMax: 40 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 500; i++) lim.onSuccess();
    assert.equal(lim.budget, 40);
  });
});

test('a ban and a cut budget survive a restart', async () => {
  await withTempLimiter({ budget: 16, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    make().on429(900_000);
    const restarted = make();
    assert.equal(restarted.budget, 8);
    assert.ok(restarted.availableAt() - Date.now() > 890_000);
  });
});

test('a served ban keeps the window history', async () => {
  await withTempLimiter({ budget: 5, windowMs: 2_500, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 5; i++) await lim.acquire();
    assert.equal(lim.remaining(), 0);

    lim.on429(20);
    const before = lim.history.length;
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(lim.history.length, before, 'the history should outlive the ban');
    assert.ok(lim.availableAt() > Date.now(), 'budget still spent, waiting out the window');
  });
});

test('pace spreads the budget over the window', async () => {
  await withTempLimiter({ budget: 12, windowMs: 3_600_000, minIntervalMs: 900 }, async (make) => {
    assert.equal(make().pace(), 300_000);
  });
});

test('pace does not drop below minIntervalMs', async () => {
  await withTempLimiter({ budget: 100, windowMs: 10_000, minIntervalMs: 900 }, async (make) => {
    assert.equal(make().pace(), 900);
  });
});

test('acquire holds the pace', async () => {
  await withTempLimiter({ budget: 10, windowMs: 1_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    const t0 = Date.now();
    await lim.acquire();
    await lim.acquire();
    await lim.acquire();
    assert.ok(Date.now() - t0 >= 200, 'three requests cannot fit in less than two gaps');
  });
});

test('onWait reports a pause on a spent budget', async () => {
  await withTempLimiter({ budget: 1, windowMs: 200, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    const reasons = [];
    lim.onWait = (ms, reason) => reasons.push(reason);
    await lim.acquire();
    await lim.acquire();
    assert.deepEqual(reasons, ['window budget spent']);
  });
});

test('fmtDuration formats readably', () => {
  assert.equal(fmtDuration(5_000), '5s');
  assert.equal(fmtDuration(90_000), '1m 30s');
  assert.equal(fmtDuration(1_567_600), '26m 8s');
  assert.equal(fmtDuration(7_200_000), '2h 0m');
});

test('the window stretches when a ban lands right after a ban', async () => {
  await withTempLimiter({ budget: 12, windowMs: 60 * 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.onSuccess();
    lim.on429(1_800_000);
    assert.equal(lim.windowMs, 2 * 60 * 60_000);
    assert.equal(lim.budget, 6);
  });
});

test('the window holds when the budget worked', async () => {
  await withTempLimiter({ budget: 12, windowMs: 60 * 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 6; i++) lim.onSuccess();
    lim.on429(1_800_000);
    assert.equal(lim.windowMs, 60 * 60_000);
  });
});

test('the window stops stretching at six hours', async () => {
  await withTempLimiter({ budget: 8, windowMs: 5 * 60 * 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 5; i++) lim.on429(1_800_000);
    assert.equal(lim.windowMs, 6 * 60 * 60_000);
  });
});

test('a stretched window survives a restart', async () => {
  await withTempLimiter({ budget: 12, windowMs: 60 * 60_000, minIntervalMs: 0 }, async (make) => {
    make().on429(1_800_000);
    assert.equal(make().windowMs, 2 * 60 * 60_000);
  });
});

test('the budget does not fall below two', async () => {
  await withTempLimiter({ budget: 4, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    for (let i = 0; i < 8; i++) lim.on429(600_000);
    assert.equal(lim.budget, 2);
  });
});

test('growth stops below the breached budget', async () => {
  await withTempLimiter({ budget: 34, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(188_000);
    assert.equal(lim.budget, 17);
    assert.equal(lim.growthCap(), 25);
    for (let i = 0; i < 2000; i++) lim.onSuccess();
    assert.equal(lim.budget, 25, 'grew to the ceiling and stopped short of the wall');
  });
});

test('a repeat 429 at a lower budget lowers the ceiling', async () => {
  await withTempLimiter({ budget: 40, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(188_000);
    assert.equal(lim.growthCap(), 30);
    lim.budget = 24;
    lim.on429(188_000);
    assert.equal(lim.ceiling, 24);
    assert.equal(lim.growthCap(), 18);
  });
});

test('the ceiling only comes down', async () => {
  await withTempLimiter({ budget: 20, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(188_000);
    assert.equal(lim.ceiling, 20);
    lim.budget = 38;
    lim.on429(188_000);
    assert.equal(lim.ceiling, 20);
  });
});

test('a short bucket 429 does not set a wall', async () => {
  await withTempLimiter({ budget: 30, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    const lim = make();
    lim.on429(1_200);
    assert.equal(lim.ceiling, null);
    assert.equal(lim.growthCap(), 40);
  });
});

test('a found wall survives a restart', async () => {
  await withTempLimiter({ budget: 34, windowMs: 60_000, minIntervalMs: 0 }, async (make) => {
    make().on429(188_000);
    assert.equal(make().growthCap(), 25);
  });
});
