// Tests for pending-offer helpers — the structural fix for the
// "Yes please → Clarification Request for 'Yes Please'" bug surfaced in WhatsApp.
// These helpers are the contract that turns a delayed/short user confirmation
// back into the right artifact. Coverage is mandatory because they live behind a
// 7,500-line webhook and a regression here re-opens a user-visible bug.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PENDING_OFFER_TTL_MS,
  classifyConfirmationReply,
  isBadTitle,
  isPendingOfferFresh,
  looksLikeConfirmation,
  type PendingOffer,
} from "./pending-offer.ts";

const NOW = Date.UTC(2026, 3, 27, 12, 0, 0);

function offer(ageMs: number): PendingOffer {
  return {
    type: 'save_artifact',
    artifact_content: 'A Megaformer studio is a fitness spot focused on Lagree Fitness…',
    artifact_request: 'Can you search what is a Megaformer studio?',
    artifact_kind: 'web_search',
    offered_at: new Date(NOW - ageMs).toISOString(),
  };
}

// ---------- isPendingOfferFresh ----------

Deno.test('isPendingOfferFresh: null/undefined → false', () => {
  assertEquals(isPendingOfferFresh(null, NOW), false);
  assertEquals(isPendingOfferFresh(undefined, NOW), false);
});

Deno.test('isPendingOfferFresh: missing offered_at → false', () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(isPendingOfferFresh({ type: 'save_artifact' } as any, NOW), false);
});

Deno.test('isPendingOfferFresh: invalid date → false', () => {
  assertEquals(
    isPendingOfferFresh({ ...offer(0), offered_at: 'not-a-date' }, NOW),
    false,
  );
});

Deno.test('isPendingOfferFresh: just now → true', () => {
  assertEquals(isPendingOfferFresh(offer(0), NOW), true);
});

Deno.test('isPendingOfferFresh: 9 minutes old → true', () => {
  assertEquals(isPendingOfferFresh(offer(9 * 60 * 1000), NOW), true);
});

Deno.test('isPendingOfferFresh: at TTL boundary → false (exclusive)', () => {
  assertEquals(isPendingOfferFresh(offer(PENDING_OFFER_TTL_MS), NOW), false);
});

Deno.test('isPendingOfferFresh: past TTL → false', () => {
  assertEquals(isPendingOfferFresh(offer(15 * 60 * 1000), NOW), false);
});

Deno.test('isPendingOfferFresh: future timestamp → false (clock skew defense)', () => {
  assertEquals(isPendingOfferFresh(offer(-60 * 1000), NOW), false);
});

// ---------- classifyConfirmationReply: AFFIRM ----------

const AFFIRMATIVES = [
  // The exact phrase from the screenshot bug
  'Yes please',
  'yes please',
  'YES PLEASE',
  // Single-word
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'k',
  // With punctuation/emoji that should be stripped
  'yes!', 'yes 🙏', 'sure!!', 'ok 👍',
  // Multi-word combos
  'yes please save it',
  'do it',
  'go ahead',
  'save it',
  'save this',
  'sounds good',
  // Spanish
  'sí', 'si', 'claro', 'claro que sí', 'sí por favor', 'guárdalo', 'hazlo', 'dale',
  // Italian
  'sì', 'sì grazie', 'va bene', 'fallo', 'salvalo', 'certo', 'dai',
];

for (const msg of AFFIRMATIVES) {
  Deno.test(`classifyConfirmationReply: "${msg}" → affirm`, () => {
    assertEquals(classifyConfirmationReply(msg), 'affirm');
  });
}

// ---------- classifyConfirmationReply: DENY ----------

const DENIALS = [
  'no', 'No', 'NOPE', 'nah', 'not now', 'skip', 'never mind', 'forget it',
  'no thanks', 'no thank you',
  'no gracias', 'déjalo',
  'no grazie', 'lascia stare',
];

for (const msg of DENIALS) {
  Deno.test(`classifyConfirmationReply: "${msg}" → deny`, () => {
    assertEquals(classifyConfirmationReply(msg), 'deny');
  });
}

// ---------- classifyConfirmationReply: PASS-THROUGH (must NOT match) ----------

const PASS_THROUGH = [
  // Empty / whitespace
  '', '   ', null, undefined,
  // Genuine follow-up questions — must NOT hijack the offer
  'yes but actually can you tell me about Pilates instead?',
  'no I meant the other studio',
  'yes I want to also schedule a class',
  // Long unrelated messages
  'Can you also tell me how much these studios cost on average and where the closest one to me is?',
  // Save-this commands handled by safety net #1.5, not #1.4
  'save this as a note in my fitness list',
  // Random
  'maybe later',
  'I think so',
  'hmm',
];

for (const msg of PASS_THROUGH) {
  Deno.test(`classifyConfirmationReply: "${String(msg).slice(0, 40)}" → null`, () => {
    assertEquals(classifyConfirmationReply(msg as string), null);
  });
}

// ---------- isBadTitle: catches the screenshot bug ----------

Deno.test('isBadTitle: catches the literal screenshot bug title', () => {
  // This is exactly what Olive saved in the bug report.
  assertEquals(isBadTitle(`Clarification Request for "Yes Please"`), true);
});

Deno.test('isBadTitle: catches confirmation-phrase titles', () => {
  assertEquals(isBadTitle('Yes please'), true);
  assertEquals(isBadTitle('Save it'), true);
  assertEquals(isBadTitle('Sì grazie'), true);
  assertEquals(isBadTitle('Claro que sí'), true);
});

Deno.test('isBadTitle: catches generic placeholders', () => {
  assertEquals(isBadTitle('Saved Draft'), true);
  assertEquals(isBadTitle('save note'), true);
  assertEquals(isBadTitle('Note'), true);
  assertEquals(isBadTitle('Untitled'), true);
});

Deno.test('isBadTitle: empty / null / whitespace', () => {
  assertEquals(isBadTitle(''), true);
  assertEquals(isBadTitle('   '), true);
  assertEquals(isBadTitle(null), true);
  assertEquals(isBadTitle(undefined), true);
});

Deno.test('isBadTitle: real topic titles → false', () => {
  assertEquals(isBadTitle('Megaformer Studios — What They Are'), false);
  assertEquals(isBadTitle('Best Cities to Visit in Italy'), false);
  assertEquals(isBadTitle('Email Draft to Boss About Vacation'), false);
  assertEquals(isBadTitle('Gift Ideas for Sara\'s Birthday'), false);
});

// ---------- looksLikeConfirmation: used by SAVE_ARTIFACT fallback ----------

Deno.test('looksLikeConfirmation: yes/sí/sì → true', () => {
  assertEquals(looksLikeConfirmation('Yes please'), true);
  assertEquals(looksLikeConfirmation('sí'), true);
  assertEquals(looksLikeConfirmation('sì grazie'), true);
});

Deno.test('looksLikeConfirmation: real questions → false', () => {
  assertEquals(looksLikeConfirmation('Can you search what is a Megaformer studio?'), false);
  assertEquals(looksLikeConfirmation('What are the best Italian wines?'), false);
});

Deno.test('looksLikeConfirmation: empty → false', () => {
  assertEquals(looksLikeConfirmation(''), false);
  assertEquals(looksLikeConfirmation(null), false);
  assertEquals(looksLikeConfirmation(undefined), false);
});
