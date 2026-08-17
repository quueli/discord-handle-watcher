import { config } from './config.mjs';
import { checkAvailability } from './api.mjs';
import { closeHttp } from './http.mjs';
import { log } from './notify.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function watch(targets) {
  if (!targets.length) throw new Error('no targets. Set WATCH_TARGETS or pass --targets');
  log('info', `watching: ${targets.join(', ')}`);

  for (;;) {
    for (const name of targets) {
      try {
        const free = await checkAvailability(name);
        log('info', `${name} -> ${free ? 'available' : 'taken'}`);
        if (free) log('good', `${name} is free`);
      } catch (err) {
        log('warn', `${name}: ${err.message}`);
      }
    }
    await sleep(config.cycleDelayMs);
  }
}

export async function stop() {
  await closeHttp();
}
