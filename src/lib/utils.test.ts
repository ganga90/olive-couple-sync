import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn (className merger)', () => {
  it('merges plain class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    // clsx accepts falsy values in its type signature — no @ts-expect-error needed.
    expect(cn('a', null, undefined, false, '')).toBe('a');
  });

  it('uses twMerge to dedupe tailwind conflicts', () => {
    // The later class wins for conflicting Tailwind utilities.
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('accepts arrays and conditional objects (clsx contract)', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
