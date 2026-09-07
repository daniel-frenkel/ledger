import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { uuidv7, uuidv7Time } from '../src/index.js';

const rand = (n: number) => new Uint8Array(randomBytes(n));

describe('uuidv7', () => {
  it('is a valid v7 uuid', () => {
    const id = uuidv7(rand);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('encodes the timestamp and sorts by time', () => {
    const t = 1_788_000_000_000;
    const a = uuidv7(rand, t);
    const b = uuidv7(rand, t + 1);
    expect(uuidv7Time(a)).toBe(t);
    expect(a < b).toBe(true);
  });
  it('is unique', () => {
    const s = new Set(Array.from({ length: 2000 }, () => uuidv7(rand)));
    expect(s.size).toBe(2000);
  });
});
