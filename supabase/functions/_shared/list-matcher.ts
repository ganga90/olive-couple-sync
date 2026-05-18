// ============================================================================
// Shared list matcher — used by SEARCH and CONTEXTUAL_ASK in whatsapp-webhook,
// and by SAVE_ARTIFACT for smart-routing of saved chat replies into lists.
//
// Goal: when the user names a list ("my book list", "the travel list"), find
// the actual user's list by ID. The previous code path duplicated this logic
// inline in the SEARCH branch and did NOT run it at all in CONTEXTUAL_ASK,
// which is why questions like "What's in my book list?" sometimes returned a
// hallucinated reply (CONTEXTUAL_ASK saw the user's items but didn't know
// which list to anchor on, and word-overlap scoring missed them when item
// titles didn't contain the word "book").
//
// `resolveSaveTargetList` (added April 2026) extends this module with a
// resolver used by SAVE_ARTIFACT: given the AI classifier's suggestion + the
// user's existing lists, decide which list to file into — matching an
// existing one when possible, creating a new one on high confidence, or
// returning null when there's no good home. A smaller version of the
// 9-priority cascade in `process-note/index.ts:findOrCreateList`; the full
// cascade can be ported here in a follow-up refactor so both callers share it.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface UserList {
  id: string;
  name: string;
  description?: string | null;
}

export interface ListMatch {
  listId: string;
  listName: string;
  matchedVia: 'ai_hint' | 'regex' | 'fuzzy';
}

export function normalizeListName(name: string): string {
  return name.toLowerCase()
    .replace(/\b(the|a|an|my|our)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const LIST_EXTRACTION_PATTERNS: RegExp[] = [
  /(?:show|display|open|get|see)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
  /(?:what'?s|whats)\s+(?:in|on)\s+(?:the\s+|my\s+|our\s+)?(.+?)\s+(?:list|tasks?|items?)$/i,
  /^list\s+(?:my\s+|the\s+|our\s+)?(.+?)$/i,
  /^(?:my|our)\s+(.+?)(?:\s+list)?$/i,
  /^(.+?)\s+list$/i,
  /(?:show|display|open|get|see|what'?s\s+in)\s+(?:me\s+)?(?:the\s+|my\s+|our\s+)?(.+?)$/i,
];

const GENERIC_WORDS = new Set(['tasks', 'task', 'all', 'everything', 'stuff', 'things', 'my', 'me', 'the']);

/**
 * Find the user's list that matches the user's reference.
 *
 * @param message  Raw user message (e.g., "What's in my book list?")
 * @param lists    User's lists (id + name)
 * @param aiListName  Optional list_name from the AI classifier — preferred over regex
 * @returns ListMatch if a match is found, null otherwise
 */
export function findUserList(
  message: string,
  lists: UserList[],
  aiListName?: string | null,
): ListMatch | null {
  if (!lists || lists.length === 0) return null;

  // PRIORITY 1: Use AI-provided list_name if available (most reliable)
  if (aiListName) {
    const aiNormalized = normalizeListName(aiListName);
    const aiSingular = singularize(aiNormalized);
    for (const list of lists) {
      const nln = normalizeListName(list.name);
      const nlnS = singularize(nln);
      if (
        nln === aiNormalized ||
        nlnS === aiSingular ||
        nln.includes(aiNormalized) ||
        aiNormalized.includes(nln) ||
        nlnS.includes(aiSingular) ||
        aiSingular.includes(nlnS)
      ) {
        return { listId: list.id, listName: list.name, matchedVia: 'ai_hint' };
      }
    }
  }

  // PRIORITY 2: Regex extraction from cleaned message
  const cleanedMessage = (message || '').replace(/[?!.]+$/, '').trim();
  for (const pattern of LIST_EXTRACTION_PATTERNS) {
    const match = cleanedMessage.match(pattern);
    if (!match) continue;

    const rawExtracted = normalizeListName(match[1]);
    if (!rawExtracted || rawExtracted.length < 2) continue;
    if (GENERIC_WORDS.has(rawExtracted)) continue;

    const extractedSingular = singularize(rawExtracted);

    for (const list of lists) {
      const nln = normalizeListName(list.name);
      const nlnS = singularize(nln);

      if (nln === rawExtracted || nln === extractedSingular) {
        return { listId: list.id, listName: list.name, matchedVia: 'regex' };
      }
      if (nlnS === extractedSingular) {
        return { listId: list.id, listName: list.name, matchedVia: 'regex' };
      }
      if (nln.includes(rawExtracted) || rawExtracted.includes(nln)) {
        return { listId: list.id, listName: list.name, matchedVia: 'fuzzy' };
      }
      if (nlnS.includes(extractedSingular) || extractedSingular.includes(nlnS)) {
        return { listId: list.id, listName: list.name, matchedVia: 'fuzzy' };
      }
    }
  }

  return null;
}

// ============================================================================
// resolveSaveTargetList — used by SAVE_ARTIFACT to pick (or create) a list
// for a saved chat reply, given the AI classifier's nomination.
//
// Ported from a subset of `process-note/index.ts:findOrCreateList` (priorities
// 0, 4, 5). Full 9-priority cascade can be migrated here in a follow-up so
// both callers share a single resolver.
// ============================================================================

/** Title-cased display name for a known category key. The map mirrors the
 *  one in process-note (lines 2441–2468) for the categories that meaningfully
 *  apply to a saved chat reply. Unknown categories pass through the
 *  Title-case helper below. */
const CANONICAL_LIST_NAMES: Record<string, { displayName: string; aliases: string[] }> = {
  groceries: { displayName: 'Groceries', aliases: ['grocery', 'groceries', 'food shopping', 'supermarket'] },
  health: { displayName: 'Health', aliases: ['health', 'wellness', 'medical', 'supplements', 'vitamins', 'fitness'] },
  travel: { displayName: 'Travel', aliases: ['travel', 'trips', 'trip', 'vacation', 'vacations', 'flights'] },
  entertainment: { displayName: 'Entertainment', aliases: ['entertainment', 'events', 'fun', 'nightlife', 'concerts'] },
  shopping: { displayName: 'Shopping', aliases: ['shopping', 'wishlist', 'wish list', 'purchases'] },
  home_improvement: { displayName: 'Home Improvement', aliases: ['home improvement', 'home', 'repairs', 'maintenance', 'renovation'] },
  finance: { displayName: 'Finance', aliases: ['finance', 'finances', 'bills', 'budget', 'investments', 'money'] },
  books: { displayName: 'Books', aliases: ['books', 'book', 'reading', 'to read'] },
  movies_tv: { displayName: 'Movies & TV', aliases: ['movies tv', 'movies & tv', 'movies and tv', 'movie', 'movies', 'tv shows', 'tv show', 'series', 'to watch'] },
  recipes: { displayName: 'Recipes', aliases: ['recipes', 'recipe', 'cooking', 'meals'] },
  date_ideas: { displayName: 'Date Ideas', aliases: ['date ideas', 'date idea', 'restaurants', 'restaurant', 'romantic'] },
  errands: { displayName: 'Errands', aliases: ['errands', 'errand', 'dry cleaning', 'pickups', 'returns'] },
  personal: { displayName: 'Personal', aliases: ['personal', 'admin'] },
  work: { displayName: 'Work', aliases: ['work', 'office', 'career', 'professional'] },
  gift_ideas: { displayName: 'Gift Ideas', aliases: ['gift ideas', 'gift idea', 'gifts', 'gift', 'presents'] },
  stocks: { displayName: 'Investments', aliases: ['stocks', 'stock', 'investing', 'portfolio', 'trading'] },
  research: { displayName: 'Research', aliases: ['research', 'report', 'study', 'analysis', 'paper'] },
  education: { displayName: 'Education', aliases: ['education', 'learning', 'courses', 'school', 'university'] },
  contacts: { displayName: 'Contacts', aliases: ['contacts', 'contact', 'people', 'business cards', 'networking'] },
};

/** Generic list names that should NEVER be matched by accident. If the AI
 *  suggests one of these, we treat it as confidence=low and fall through. */
const GENERIC_LIST_NAMES = new Set(['task', 'tasks', 'general', 'other', 'misc', 'notes', 'note']);

/** Convert a snake_case or unknown category to Title Case for display.
 *  Mirrors process-note line 2750ish ("real_estate" → "Real Estate"). */
function titleCaseCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Loose equivalence between two list names. Catches singular/plural,
 *  underscore-vs-space, and canonical aliases. Same shape as process-note's
 *  `areNamesEquivalent` (line 2479) so behavior matches across both callers. */
function areNamesEquivalent(nameA: string, nameB: string): boolean {
  const a = normalizeListName(nameA);
  const b = normalizeListName(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Singular / plural collapse.
  if (singularize(a) === singularize(b)) return true;
  // Canonical alias overlap — both names map to the same canonical entry.
  for (const entry of Object.values(CANONICAL_LIST_NAMES)) {
    const aliases = entry.aliases.map((al) => normalizeListName(al));
    if (aliases.includes(a) && aliases.includes(b)) return true;
  }
  return false;
}

/** Find the first existing list equivalent to `name`. Returns null if no
 *  candidate is within the equivalence threshold. */
function findEquivalentList(name: string, lists: UserList[]): UserList | null {
  if (!lists || lists.length === 0) return null;
  for (const list of lists) {
    if (areNamesEquivalent(list.name, name)) return list;
  }
  return null;
}

export interface ResolveSaveTargetListInput {
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>;
  userId: string;
  /** Couple ID for the user, if any. Reserved — write path uses spaceId now. */
  coupleId: string | null;
  /** Space ID to scope a newly-created list to. Pass null for personal scope. */
  spaceId: string | null;
  /** The user's existing lists. Caller fetches these once for both the
   *  classifier prompt and this resolver. Capped at 30 by the caller. */
  existingLists: UserList[];
  /** The classifier's nomination. `name=null` means "no opinion". */
  aiSuggestion: {
    name: string | null;
    isNew: boolean;
    confidence: 'high' | 'medium' | 'low';
  };
  /** The classifier's category + title — used as a fallback when the AI
   *  nominated nothing but the category maps to a canonical list. */
  classification: { category: string; tags: string[]; title: string };
  /** Lowest confidence that should trigger a new-list CREATE. Default 'high'. */
  confidenceFloor?: 'high' | 'medium';
}

export interface ResolveSaveTargetListResult {
  listId: string;
  listName: string;
  /** True iff the resolver had to INSERT a new clerk_lists row. */
  created: boolean;
}

/**
 * Decide which list to file a saved-chat-reply into, creating one if needed.
 * Returns null when no resolution is possible (resolver gave up — caller
 * should fall back to list_id=null).
 *
 * Order of operations:
 *   1. AI suggested an existing list → equivalence match → use it.
 *   2. AI suggested a NEW list, high confidence, no equivalence collision
 *      → INSERT clerk_lists, return new id. Race-condition guarded.
 *   3. AI gave nothing (null), but classification.category maps to a
 *      canonical list that already exists → use it.
 *   4. Give up → return null.
 */
export async function resolveSaveTargetList(
  input: ResolveSaveTargetListInput,
): Promise<ResolveSaveTargetListResult | null> {
  const { supabase, userId, spaceId, existingLists, aiSuggestion, classification } = input;
  const floor = input.confidenceFloor ?? 'high';
  const meetsFloor = (c: 'high' | 'medium' | 'low'): boolean =>
    floor === 'high' ? c === 'high' : c === 'high' || c === 'medium';

  // ── Step 1: AI nominated an existing list (by name, isNew=false).
  if (aiSuggestion.name && !aiSuggestion.isNew && meetsFloor(aiSuggestion.confidence)) {
    const matched = findEquivalentList(aiSuggestion.name, existingLists);
    if (matched) {
      console.log('[resolveSaveTargetList] AI matched existing list:', matched.name);
      return { listId: matched.id, listName: matched.name, created: false };
    }
    // AI claimed isNew=false but the name doesn't match — fall through;
    // a NEW list would be the right call IF the AI just got the flag wrong.
    // We don't auto-create in this branch (the AI didn't ask for it).
  }

  // ── Step 2: AI proposed a NEW list with sufficient confidence.
  if (aiSuggestion.name && aiSuggestion.isNew && meetsFloor(aiSuggestion.confidence)) {
    const collision = findEquivalentList(aiSuggestion.name, existingLists);
    if (collision) {
      // Equivalence final-check (mirrors process-note line 2773) — prevents
      // "Travels" being created when "Travel" already exists.
      console.log('[resolveSaveTargetList] AI proposed new list but equivalent exists:', collision.name);
      return { listId: collision.id, listName: collision.name, created: false };
    }
    const proposedName = aiSuggestion.name.trim();
    if (proposedName && !GENERIC_LIST_NAMES.has(proposedName.toLowerCase())) {
      const created = await createList(supabase, userId, spaceId, proposedName);
      if (created) {
        console.log('[resolveSaveTargetList] Created new list:', created.name);
        return { listId: created.id, listName: created.name, created: true };
      }
      // Creation failed (e.g., RLS) — fall through.
    }
  }

  // ── Step 3: AI gave nothing, but the category maps to a canonical list
  //           that already exists in the user's lists.
  if (!aiSuggestion.name && classification.category) {
    const canonical = CANONICAL_LIST_NAMES[classification.category];
    if (canonical) {
      const matched = findEquivalentList(canonical.displayName, existingLists);
      if (matched) {
        console.log('[resolveSaveTargetList] Category-canonical match:', matched.name);
        return { listId: matched.id, listName: matched.name, created: false };
      }
    }
  }

  // ── Give up — caller writes list_id=null.
  return null;
}

/** Insert a new clerk_lists row. Mirrors process-note line 2782–2828:
 *  writes space_id only (couple_id is derived by a BEFORE INSERT trigger),
 *  handles the 23505 race by re-fetching the existing row. Exported only
 *  for the resolver — callers shouldn't bypass `resolveSaveTargetList`. */
async function createList(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  spaceId: string | null,
  listName: string,
): Promise<{ id: string; name: string } | null> {
  try {
    const { data: newList, error: createError } = await supabase
      .from('clerk_lists')
      .insert([{
        name: listName,
        description: `Auto-created when you saved a chat reply`,
        is_manual: false,
        author_id: userId,
        space_id: spaceId || null,
      }])
      .select()
      .single();

    if (createError) {
      // deno-lint-ignore no-explicit-any
      const code = (createError as any).code;
      if (code === '23505') {
        // Race condition — another concurrent save just created the same list.
        // Re-fetch and use it.
        console.log('[resolveSaveTargetList] 23505 race, fetching existing:', listName);
        const { data: existing } = await supabase
          .from('clerk_lists')
          .select('id, name')
          .ilike('name', listName)
          .or(spaceId ? `space_id.eq.${spaceId}` : `author_id.eq.${userId}`)
          .limit(1)
          .single();
        return existing ? { id: existing.id, name: existing.name } : null;
      }
      console.error('[resolveSaveTargetList] Insert failed:', createError);
      return null;
    }
    return newList ? { id: newList.id, name: newList.name } : null;
  } catch (err) {
    console.error('[resolveSaveTargetList] Exception during create:', err);
    return null;
  }
}

/** Exported for tests — verify the canonical map + helpers without running
 *  the full resolver. */
export const __internals__ = {
  areNamesEquivalent,
  findEquivalentList,
  titleCaseCategory,
  CANONICAL_LIST_NAMES,
  GENERIC_LIST_NAMES,
};
