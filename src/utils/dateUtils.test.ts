import { describe, it, expect } from 'vitest';
import {
  parseDateSafely,
  formatDateForStorage,
  dateStringToStorage,
  extractDateOnly,
  parseUserDateInput,
} from './dateUtils';

describe('dateUtils — timezone-safe date handling', () => {
  describe('parseDateSafely', () => {
    it('parses YYYY-MM-DD at noon local time (no timezone shift)', () => {
      const d = parseDateSafely('2026-02-20');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(1); // Feb is 1
      expect(d!.getDate()).toBe(20);
      expect(d!.getHours()).toBe(12); // noon, avoids the timezone-shift bug
    });

    it('parses ISO datetime by extracting the date part', () => {
      const d = parseDateSafely('2026-12-31T03:30:00.000Z');
      expect(d!.getDate()).toBe(31);
      expect(d!.getMonth()).toBe(11);
    });

    it('returns null for null, undefined, empty, or malformed input', () => {
      expect(parseDateSafely(null)).toBeNull();
      expect(parseDateSafely(undefined)).toBeNull();
      expect(parseDateSafely('')).toBeNull();
      expect(parseDateSafely('not-a-date')).toBeNull();
    });

    it.todo('rejects out-of-range components like 2026-13-99 (current impl coerces via Date)');
  });

  describe('formatDateForStorage', () => {
    it('formats a Date to noon-UTC ISO string', () => {
      const d = new Date(2026, 5, 15, 9, 30); // June 15, 9:30am local
      const stored = formatDateForStorage(d);
      expect(stored).toBe('2026-06-15T12:00:00.000Z');
    });

    it('returns null for null/undefined', () => {
      expect(formatDateForStorage(null)).toBeNull();
      expect(formatDateForStorage(undefined)).toBeNull();
    });
  });

  describe('dateStringToStorage', () => {
    it('converts YYYY-MM-DD to noon-UTC ISO', () => {
      expect(dateStringToStorage('2026-03-08')).toBe('2026-03-08T12:00:00.000Z');
    });

    it('strips the time portion when input is an ISO string', () => {
      expect(dateStringToStorage('2026-03-08T22:00:00.000Z')).toBe(
        '2026-03-08T12:00:00.000Z'
      );
    });

    it('rejects malformed dates', () => {
      expect(dateStringToStorage('not-a-date')).toBeNull();
      expect(dateStringToStorage('2026-3-8')).toBeNull(); // missing zero-padding
      expect(dateStringToStorage(null)).toBeNull();
    });
  });

  describe('extractDateOnly', () => {
    it('strips time from ISO; passes through YYYY-MM-DD', () => {
      expect(extractDateOnly('2026-05-17T12:00:00.000Z')).toBe('2026-05-17');
      expect(extractDateOnly('2026-05-17')).toBe('2026-05-17');
      expect(extractDateOnly(null)).toBe('');
    });
  });

  describe('parseUserDateInput', () => {
    it('accepts dd/MM/yyyy and MM/dd/yyyy', () => {
      // 13/05/2026 is unambiguously dd/MM/yyyy (13 > 12 so MM/dd/yyyy fails first).
      const d = parseUserDateInput('13/05/2026');
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(4); // May
      expect(d!.getDate()).toBe(13);
    });

    it('accepts ISO yyyy-MM-dd', () => {
      const d = parseUserDateInput('2026-05-17');
      expect(d!.getFullYear()).toBe(2026);
    });

    it('rejects garbage and pre-2000 dates', () => {
      expect(parseUserDateInput('garbage')).toBeNull();
      expect(parseUserDateInput('01/01/1999')).toBeNull();
    });
  });
});
