import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capacitor mock — the helper reads `Capacitor.isNativePlatform()` at call
// time, so a per-test override is fine.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

import { Capacitor } from '@capacitor/core';
import { NOTE_SOURCES, defaultClientNoteSource, type NoteSource } from './note-source';

describe('NOTE_SOURCES enum', () => {
  it('contains every value that the DB CHECK constraint allows', () => {
    // If this list changes, also update:
    //   1. supabase/functions/_shared/note-insert.ts
    //   2. the clerk_notes_source_known CHECK constraint
    expect([...NOTE_SOURCES].sort()).toEqual([
      'brain-dump',
      'email',
      'ios',
      'olive-chat',
      'partner-relay',
      'receipt',
      'save-link',
      'system',
      'web',
      'whatsapp',
      'whatsapp-media',
      'whatsapp-voice',
    ]);
  });

  it('is typed as a const tuple — TS narrows NoteSource to a literal union', () => {
    // Compile-time check via runtime assertion: every member is a valid NoteSource.
    for (const s of NOTE_SOURCES) {
      const narrowed: NoteSource = s;
      expect(typeof narrowed).toBe('string');
    }
  });
});

describe('defaultClientNoteSource', () => {
  beforeEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReset();
  });

  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReset();
  });

  it('returns "ios" inside the Capacitor native shell', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    expect(defaultClientNoteSource()).toBe('ios');
  });

  it('returns "web" otherwise (Vercel deploy, localhost dev)', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    expect(defaultClientNoteSource()).toBe('web');
  });
});
