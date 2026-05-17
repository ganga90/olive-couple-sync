#!/usr/bin/env node
//
// i18n parity guard.
//
// Asserts that every namespace JSON in public/locales/<locale>/ has the same
// flattened key set as the corresponding file in public/locales/en/ (the
// canonical source). EN is the source of truth — any key present in EN must
// exist in every other locale; any key in a non-en locale that doesn't exist
// in EN is dead weight (an old key that was renamed).
//
// Why this matters
//   The 10X audit found 17 keys missing across profile/home/onboarding for
//   both es-ES and it-IT, silently shipping English fallbacks to Spanish and
//   Italian users mid-flow. This script is the gate that keeps drift from
//   coming back.
//
// Usage
//   node scripts/check-i18n-parity.mjs
//
// Exit codes
//   0  - parity OK
//   1  - drift detected (missing or extra keys somewhere)
//
// Wired into .github/workflows/frontend-ci.yml so any PR that adds an EN key
// without adding the same key to es-ES and it-IT fails the check.

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'public', 'locales');
const SOURCE_LOCALE = 'en';

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function listNamespaces(locale) {
  return readdirSync(join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))
    .sort();
}

function loadFlat(locale, ns) {
  const path = join(LOCALES_DIR, locale, `${ns}.json`);
  const raw = readFileSync(path, 'utf8');
  return flatten(JSON.parse(raw));
}

const locales = readdirSync(LOCALES_DIR).filter((d) => d !== SOURCE_LOCALE).sort();
const sourceNamespaces = listNamespaces(SOURCE_LOCALE);

let issues = 0;
const report = [];

// 1) Every non-EN locale must have the same namespace files as EN.
for (const loc of locales) {
  const locNamespaces = new Set(listNamespaces(loc));
  for (const ns of sourceNamespaces) {
    if (!locNamespaces.has(ns)) {
      report.push(`MISSING_FILE: ${loc}/${ns}.json (exists in ${SOURCE_LOCALE}/)`);
      issues++;
    }
  }
  for (const ns of locNamespaces) {
    if (!sourceNamespaces.includes(ns)) {
      report.push(`EXTRA_FILE: ${loc}/${ns}.json (not in ${SOURCE_LOCALE}/) — orphan, consider deleting`);
      issues++;
    }
  }
}

// 2) For every (locale, namespace), flattened keys must match EN exactly.
for (const ns of sourceNamespaces) {
  const sourceKeys = new Set(Object.keys(loadFlat(SOURCE_LOCALE, ns)));
  for (const loc of locales) {
    const locFile = join(LOCALES_DIR, loc, `${ns}.json`);
    let locFlat;
    try {
      locFlat = loadFlat(loc, ns);
    } catch {
      continue; // already reported as MISSING_FILE above
    }
    const locKeys = new Set(Object.keys(locFlat));
    const missing = [...sourceKeys].filter((k) => !locKeys.has(k)).sort();
    const extra = [...locKeys].filter((k) => !sourceKeys.has(k)).sort();
    if (missing.length) {
      report.push(`MISSING_KEYS: ${loc}/${ns}.json — ${missing.length} keys missing vs ${SOURCE_LOCALE}/`);
      for (const k of missing) report.push(`  - ${k}`);
      issues += missing.length;
    }
    if (extra.length) {
      report.push(`EXTRA_KEYS: ${loc}/${ns}.json — ${extra.length} keys not present in ${SOURCE_LOCALE}/ (rename or delete)`);
      for (const k of extra) report.push(`  + ${k}`);
      issues += extra.length;
    }
  }
}

if (issues === 0) {
  console.log(`i18n parity OK — every locale (${locales.join(', ')}) matches ${SOURCE_LOCALE}/`);
  process.exit(0);
}

console.error(`i18n parity FAILED — ${issues} issue(s):\n`);
for (const line of report) console.error(line);
console.error(`\nTo fix: add the missing keys to the affected locale files. EN is the source of truth.`);
process.exit(1);
