/**
 * The client never reads the theory.
 *
 * The standing rule: the vocabulary constants in
 * `packages/shared/src/vocabulary/` are the words the app uses, and theory
 * terms — "prior", "furnace", "precision", "floor" — do not appear in
 * client-facing copy. `counts_for` is the sharpest test of that rule so far,
 * because the thing it measures has a name in the literature (cognitive
 * immunization) and a name in the model (the reinterpret move), and the
 * question had to be written in neither.
 *
 * What is checked is the *copy*: JSX text and the string literals that read
 * like sentences. Identifiers are not copy — `allPriors()` and `setReinterp`
 * are how the code names things, and a rule that could not tell those from a
 * sentence would be a rule against naming a variable after its subject.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COUNTS_FOR } from '@ledger/shared';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

const screens = fs
  .readdirSync(path.join(src, 'screens'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(src, 'screens', f), 'utf8').replace(/\r\n?/g, '\n') }));

/** Innermost-first, so nested JSX expressions come out too. */
function stripBraces(t: string): string {
  let out = t;
  for (;;) {
    const next = out.replace(/\{[^{}]*\}/g, ' ');
    if (next === out) return out;
    out = next;
  }
}

/**
 * The words a person actually sees: JSX text, and string literals long enough
 * to be a sentence rather than a key, a path or a class name.
 */
function copyIn(text: string): string {
  const body = stripBraces(
    text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
      .replace(/^import .*$/gm, ' '),
  );

  const jsxText = [...body.matchAll(/>([^<>]+)</g)].map((m) => m[1]!);
  const sentences = [...body.matchAll(/'([^'\n]*\s[^'\n]*)'|"([^"\n]*\s[^"\n]*)"/g)].map((m) => m[1] ?? m[2] ?? '');

  return [...jsxText, ...sentences].join(' • ').toLowerCase();
}

/** Theory words, per the standing rule and proposal 06's own list. */
const FORBIDDEN = ['immunization', 'immunisation', 'prior', 'furnace', 'reinterpret', 'precision'];
const MECHANICS = ['streak', 'badge', 'trophy', 'points', 'level up'];

describe('the resolve screen', () => {
  const resolve = screens.find((s) => s.name === 'Resolve.tsx')!;

  it('asks the question', () => {
    expect(resolve).toBeDefined();
    expect(resolve.text).toContain('COUNTS_FOR');
  });

  it('shows none of the theory words', () => {
    const copy = copyIn(resolve.text);
    for (const word of FORBIDDEN) expect(copy, word).not.toContain(word);
  });

  it('asks it in the proposal’s words, and says what zero and a hundred mean', () => {
    expect(COUNTS_FOR.label).toBe('How much does this one count?');
    expect(COUNTS_FOR.hint).toContain('Zero means it doesn’t count at all');
    expect(COUNTS_FOR.hint).toContain('a hundred means it counts completely');
    for (const word of FORBIDDEN) {
      expect(`${COUNTS_FOR.label} ${COUNTS_FOR.hint}`.toLowerCase(), word).not.toContain(word);
    }
  });

  it('reproduces no item from a published instrument', () => {
    // The question is ours. The IMS is a separate instrument, administered
    // separately, and none of its items is in this repository.
    expect(resolve.text).not.toMatch(/\bIMS\b/);
  });
});

describe('every client screen', () => {
  it('shows none of the theory words', () => {
    for (const s of screens) {
      const copy = copyIn(s.text);
      for (const word of FORBIDDEN) expect(copy, `${s.name}: ${word}`).not.toContain(word);
    }
  });

  it('has no streak, badge, or progress mechanic', () => {
    for (const s of screens) {
      const copy = copyIn(s.text);
      for (const word of MECHANICS) expect(copy, `${s.name}: ${word}`).not.toContain(word);
    }
  });

  it('would notice a theory word if one were added', () => {
    // The extraction above throws a lot away. This is the check that it does
    // not throw away everything: a sentence in JSX is still seen.
    expect(copyIn('<p>The prior did not move.</p>')).toContain('prior');
    expect(copyIn("const s = 'the furnace ran again';")).toContain('furnace');
    // And that an identifier is not.
    expect(copyIn('const allPriors = 1;')).not.toContain('prior');
  });
});
