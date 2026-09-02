import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, validateTarget } from './config.mjs';

const VOWELS = [...'aeiou'];
const CONSONANTS = [...'bcdfghjklmnpqrstvwxyz'];
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const ALNUM = [...'abcdefghijklmnopqrstuvwxyz0123456789'];

function expand(pattern, len) {
  const alphabets = [];
  for (let i = 0; i < len; i++) {
    const c = pattern[i % pattern.length];
    if (c === 'c') alphabets.push(CONSONANTS);
    else if (c === 'v') alphabets.push(VOWELS);
    else if (c === 'l') alphabets.push(LETTERS);
    else if (c === 'n') alphabets.push([...'0123456789']);
    else alphabets.push(ALNUM);
  }
  let out = [''];
  for (const alpha of alphabets) {
    const next = [];
    for (const prefix of out) for (const ch of alpha) next.push(prefix + ch);
    out = next;
  }
  return out;
}

export const PATTERNS = {
  words: {
    desc: 'dictionary words from data/words4.txt',
    gen: () => wordList(),
  },
  cvcv: { desc: 'consonant-vowel-consonant-vowel: bara, tomi, keno', gen: () => expand('cvcv', 4) },
  vcvc: { desc: 'vowel-consonant-vowel-consonant: alex, imor, ozan', gen: () => expand('vcvc', 4) },
  cvvc: { desc: 'consonant-vowel-vowel-consonant: baan, riot, moon', gen: () => expand('cvvc', 4) },
  ccvc: { desc: 'consonant-consonant-vowel-consonant: blur, stan, trip', gen: () => expand('ccvc', 4) },
  letters: { desc: 'every 4-letter string (456,976 - very slow)', gen: () => expand('llll', 4) },
  alnum: { desc: 'letters + digits (1,679,616 - impractical)', gen: () => expand('aaaa', 4) },
  doubles: { desc: 'mirrors and repeats: aabb, abab, aaaa', gen: () => doubles() },
};

function wordList() {
  const path = join(DATA_DIR, 'words4.txt');
  if (!existsSync(path)) throw new Error(`missing ${path} - the words pattern is unavailable`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function doubles() {
  const out = new Set();
  for (const a of LETTERS) {
    out.add(a.repeat(4));
    for (const b of LETTERS) {
      out.add(a + a + b + b);
      out.add(a + b + a + b);
      out.add(a + b + b + a);
    }
  }
  return [...out];
}

// deterministic, so a scan is repeatable but not alphabetical
export function shuffle(arr, seed = 1) {
  const out = [...arr];
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function generate(patternName, { limit = Infinity, seed = null } = {}) {
  const p = PATTERNS[patternName];
  if (!p) throw new Error(`unknown pattern "${patternName}". Available: ${Object.keys(PATTERNS).join(', ')}`);
  let list = p.gen().filter((n) => validateTarget(n) === null);
  if (seed !== null) list = shuffle(list, seed);
  return list.slice(0, limit);
}
