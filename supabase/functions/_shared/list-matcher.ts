// ============================================================================
// Shared list matcher — used by SEARCH and CONTEXTUAL_ASK in whatsapp-webhook.
//
// Goal: when the user names a list ("my book list", "the travel list"), find
// the actual user's list by ID. The previous code path duplicated this logic
// inline in the SEARCH branch and did NOT run it at all in CONTEXTUAL_ASK,
// which is why questions like "What's in my book list?" sometimes returned a
// hallucinated reply (CONTEXTUAL_ASK saw the user's items but didn't know
// which list to anchor on, and word-overlap scoring missed them when item
// titles didn't contain the word "book").
// ============================================================================

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
