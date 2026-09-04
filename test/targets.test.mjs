import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTarget } from '../src/config.mjs';
import { generate, shuffle, PATTERNS } from '../src/gen.mjs';

test('valid targets pass', () => {
  for (const name of ['abcd', 'a1b2', 'x_y_', 'no.pe', 'ab', 'z'.repeat(32)]) {
    assert.equal(validateTarget(name), null, `${name} should be valid`);
  }
});

test('invalid targets are rejected with a reason', () => {
  const bad = {
    'ab cd': 'space',
    'ABCD!': 'special char',
    a: 'shorter than two chars',
    ['z'.repeat(33)]: 'longer than 32',
    'a..b': 'two dots in a row',
    '.abc': 'leading dot',
    'abc.': 'trailing dot',
    'café': 'non-ascii letter',
  };
  for (const [name, why] of Object.entries(bad)) {
    const problem = validateTarget(name);
    assert.ok(problem, `${name} (${why}) should be rejected`);
    assert.match(problem, /^"/, 'the message should name the target itself');
  }
});

test('uppercase is allowed, it gets lowercased', () => {
  assert.equal(validateTarget('ABCD'), null);
});

test('generated targets are valid and 4 chars', () => {
  for (const pattern of ['cvcv', 'vcvc', 'cvvc', 'ccvc', 'doubles']) {
    const list = generate(pattern, { limit: 200, seed: 1 });
    assert.ok(list.length > 0, `${pattern} is empty`);
    for (const name of list) {
      assert.equal(name.length, 4, `${pattern}: "${name}" is not 4 chars`);
      assert.equal(validateTarget(name), null, `${pattern}: "${name}" is invalid`);
    }
  }
});

test('no pattern yields duplicates', () => {
  for (const pattern of Object.keys(PATTERNS)) {
    if (pattern === 'letters' || pattern === 'alnum') continue; // millions, skip
    const list = generate(pattern);
    assert.equal(new Set(list).size, list.length, `${pattern} contains duplicates`);
  }
});

test('cvcv yields exactly 21*5*21*5 combinations', () => {
  assert.equal(generate('cvcv').length, 21 * 5 * 21 * 5);
});

test('an unknown pattern lists the known ones', () => {
  assert.throws(() => generate('nosuch'), /Available: .*cvcv/);
});

test('the word list is usable as is', () => {
  const words = generate('words');
  assert.ok(words.length > 500, `expected hundreds of words, got ${words.length}`);
  for (const word of words) {
    assert.equal(word.length, 4, `"${word}" is not 4 chars`);
    assert.equal(validateTarget(word), null, `"${word}" is invalid`);
  }
  assert.equal(new Set(words).size, words.length, 'the list has duplicates');
});

test('shuffle is deterministic by seed and loses nothing', () => {
  const base = generate('doubles');
  const a = shuffle(base, 42);
  const b = shuffle(base, 42);
  const c = shuffle(base, 43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c, 'different seeds should give a different order');
  assert.deepEqual([...a].sort(), [...base].sort(), 'the contents changed');
});

test('limit does not exceed the list size', () => {
  assert.equal(generate('doubles', { limit: 10 }).length, 10);
  assert.equal(generate('doubles', { limit: 10 ** 9 }).length, generate('doubles').length);
});
