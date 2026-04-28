// Pending Offer — the structured Capture → Offer → Confirm → Execute state.
//
// When Olive proposes an action ("Want me to save this?") and waits for the user's
// next reply, we freeze the proposal here. The frozen artifact is immune to any
// intermediate CHAT turn that would otherwise overwrite `last_assistant_*`, and
// short multilingual confirmations ("yes", "sì", "do it") can be resolved back to
// the original proposed artifact unambiguously.
//
// Today only `save_artifact` is modeled; the type field exists so future offer
// kinds (schedule_event, create_reminder, share_with_partner) plug in without a
// schema migration — they're stored in the same JSON column.

export const PENDING_OFFER_TTL_MS = 10 * 60 * 1000;

export interface PendingOffer {
  type: 'save_artifact';
  artifact_content: string;
  artifact_request: string;
  artifact_kind: 'web_search' | 'contextual_ask' | 'chat';
  offered_at: string;
}

export function isPendingOfferFresh(
  offer: PendingOffer | null | undefined,
  now: number = Date.now(),
): offer is PendingOffer {
  if (!offer || !offer.offered_at) return false;
  const t = new Date(offer.offered_at).getTime();
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age < PENDING_OFFER_TTL_MS;
}

// Multi-word phrases come BEFORE their single-word prefixes so JavaScript's
// leftmost-first alternation picks the longer match. Single-word atoms come last.
// Modifier group is `*` (not `?`) so messages like "yes please save it" — which
// chain head + 2 modifiers — still match.
const AFFIRM_RE = /^(?:claro que sí|sí por favor|sí gracias|sì per favore|sì grazie|por favor|of course|sounds good|do it|go ahead|go for it|save it|save that|save this|keep it|va bene|yes|yeah|yep|yup|yas|sure|ok|okay|k|alright|aight|please|pls|absolutely|definitely|sí|si|claro|vale|dale|hazlo|guárdalo|guardalo|guárdamelo|sì|certo|certamente|fallo|salvalo|salvala|dai)(?:\s+(?:por favor|que sí|que si|do it|save it|save that|save this|thank you|please|pls|grazie|thanks|guárdalo|salvalo|fallo|hazlo|sì|si|yes|yeah|sure|ok|okay|now))*$/i;

const DENY_RE = /^(?:no thanks|no thank you|no gracias|no por favor|no grazie|no per ora|never mind|nevermind|forget it|not now|not really|lascia stare|déjalo|dejalo|don't|do not|no|nope|nah|skip)(?:\s+(?:thank you|thanks|gracias|grazie|por favor|please|pls))*$/i;

export function classifyConfirmationReply(
  raw: string | null | undefined,
): 'affirm' | 'deny' | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 60) return null;
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[!?¡¿.,;:"'()\[\]{}🌿🫒👍👎✅❌😊😄🙏]/g, ' ')
    .replace(/[“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (AFFIRM_RE.test(cleaned)) return 'affirm';
  if (DENY_RE.test(cleaned)) return 'deny';
  return null;
}

// Generic placeholder titles + the screenshot-bug pattern ("Clarification Request
// for X"). Quotes are pre-stripped by isBadTitle, so the pattern matches without
// requiring them.
const GENERIC_TITLE_RE = /^(save\s*note|saved?\s*draft|note|task|untitled|n\/a|clarification(?:\s+request)?(?:\s+for\s+.+)?)$/i;

export function isBadTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title
    .trim()
    .replace(/['"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
  if (looksLikeConfirmation(t)) return true;
  return false;
}

// Single source of truth for "is this string fundamentally a confirmation phrase":
// reuse the same affirm regex used to detect chat replies. Title use is the same
// shape — short, mostly-affirm tokens — so one definition keeps them aligned.
export function looksLikeConfirmation(text: string | null | undefined): boolean {
  return classifyConfirmationReply(text) === 'affirm';
}
