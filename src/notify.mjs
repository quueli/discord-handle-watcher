import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.mjs';
import { fmtDuration } from './limiter.mjs';

const LOG_FILE = process.env.LOG_FILE ? resolve(process.env.LOG_FILE) : null;
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const TAG = {
  info: ['\x1b[36mINFO\x1b[0m', 'INFO'],
  good: ['\x1b[32m OK \x1b[0m', ' OK '],
  warn: ['\x1b[33mWARN\x1b[0m', 'WARN'],
  bad: ['\x1b[31mFAIL\x1b[0m', 'FAIL'],
};

// console keeps the colours, the file copy stays plain - a multi-day run is unreadable otherwise
function emit(colored, plain) {
  console.log(colored);
  if (!LOG_FILE) return;
  try {
    appendFileSync(LOG_FILE, plain + '\n');
  } catch { /* a log line is not worth taking the run down for */ }
}

export function log(level, message) {
  const [tag, plainTag] = TAG[level] ?? TAG.info;
  const time = stamp();
  emit(`\x1b[90m${time}\x1b[0m ${tag} ${message}`, `${time} ${plainTag} ${message}`);
}

function beep(times = 3) {
  if (!config.beep) return;
  for (let i = 0; i < times; i++) setTimeout(() => process.stdout.write('\x07'), i * 250);
}

async function webhook(title, description, level, fields) {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, description, level, fields, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    log('warn', `webhook not sent: ${err.message}`);
  }
}

export async function announce(level, title, message, fields = []) {
  log(level, `${title} - ${message}`);
  if (level === 'good' || level === 'bad') beep();
  await webhook(title, message, level, fields);
}

export function checked(name, taken) {
  const verdict = taken ? '\x1b[31mTAKEN\x1b[0m' : '\x1b[42;30;1m AVAIL \x1b[0m';
  const time = stamp();
  emit(
    `\x1b[90m${time}\x1b[0m \x1b[35mCHECK\x1b[0m  ${name.padEnd(6)} ${verdict}`,
    `${time} CHECK ${name.padEnd(6)} ${taken ? 'TAKEN' : 'AVAIL'}`,
  );
}

export function status(text) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r${text}   `);
}

export function endStatus() {
  if (process.stdout.isTTY) process.stdout.write('\n');
}

export function countdown(ms, reason) {
  const until = Date.now() + ms;
  const at = new Date(until).toLocaleTimeString('en-GB', { hour12: false });
  log('warn', `${reason}: pausing ${fmtDuration(ms)}, resuming at ${at}`);

  // redrawing one line is fine on a terminal; into a file it would pile up megabytes
  const tty = process.stdout.isTTY;
  const timer = setInterval(
    () => {
      const left = until - Date.now();
      if (left <= 0) {
        clearInterval(timer);
        if (tty) process.stdout.write('\r' + ' '.repeat(60) + '\r');
        return;
      }
      if (tty) process.stdout.write(`\r\x1b[90m   ${fmtDuration(left)} left          \x1b[0m`);
      else log('info', `   ${fmtDuration(left)} left`);
    },
    tty ? 1000 : 5 * 60_000,
  );
  timer.unref?.();
  return () => clearInterval(timer);
}
