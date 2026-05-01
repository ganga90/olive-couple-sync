/**
 * i18n Locale Helpers — Shared Across Edge Functions
 * ==================================================
 *
 * Single source of truth for the three locales Olive supports today
 * (English, Spanish, Italian) plus the canonical normalization from
 * the various forms the codebase uses ("it-IT", "es-ES", "es", "it",
 * empty, undefined) into a stable two-letter code.
 *
 * Why this file exists:
 *   Several layers (clerk_profiles.language_preference, RESPONSES
 *   tables, AI prompts, date formatters) all need to agree on the
 *   same normalized locale. Duplicating the normalization made it
 *   easy to introduce skew (e.g., `'it-IT'` slipping into a lookup
 *   keyed by `'it'`). All callers should import `normalizeLocale`
 *   instead of writing their own `lang.split('-')[0]` inline.
 */

export type SupportedLocale = 'en' | 'es' | 'it';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['en', 'es', 'it'];

export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
};

/**
 * Normalize a language tag to one of the supported short codes.
 * Accepts: 'en', 'EN', 'en-US', 'es', 'es-ES', 'es-MX', 'it', 'it-IT',
 * '' (empty), null, undefined.
 *
 * Anything we don't recognize falls back to 'en' — this preserves the
 * historical behavior of the WhatsApp webhook's RESPONSES lookup
 * (which always defaulted to 'en').
 */
export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  if (!input || typeof input !== 'string') return 'en';
  const short = input.trim().toLowerCase().split('-')[0];
  if (short === 'es' || short === 'it' || short === 'en') return short;
  return 'en';
}

/**
 * Human-readable name for a locale, useful when injecting into AI prompts
 * (e.g., "IMPORTANT: Respond entirely in Italian.").
 */
export function localeDisplayName(input: string | null | undefined): string {
  return LOCALE_DISPLAY_NAMES[normalizeLocale(input)];
}
