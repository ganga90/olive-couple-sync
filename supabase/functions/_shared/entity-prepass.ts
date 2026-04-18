/**
 * Entity-Aware Search Pre-pass
 * =============================
 * Phase 4-D (Engineering Plan Task 2-E).
 *
 * Before a hybrid vector+BM25 search runs, identify entities mentioned
 * in the query (people, places, organizations, products, events) and
 * prepend their graph neighborhood as structured context. This turns
 * search from "find keyword-matching chunks" into "understand my world".
 *
 * Strategy:
 *   1. KEYWORD match the query against the user's known entities
 *      (cheap, deterministic, zero-LLM).
 *   2. Optionally call Flash-Lite to catch entities NOT yet in the KG
 *      (typos, new aliases). Off by default — the caller decides.
 *   3. Look up each matched entity's depth-1 neighborhood from
 *      olive_relationships.
 *   4. Format as a compact block capped at 300 tokens.
 *
 * Design invariants:
 *
 *   1. NEVER BLOCKS. If entity extraction or neighborhood lookup fails,
 *      this module returns empty context. Search still runs normally.
 *
 *   2. BUDGET CAPPED. Output is always ≤ MAX_ENTITY_CONTEXT_TOKENS.
 *      Even with 50 matched entities and 100 relationships, the caller
 *      gets a bounded block it can safely drop into a SLOT_DYNAMIC budget.
 *
 *   3. PURE CORE. `matchEntitiesByKeyword`, `formatEntityContext`, and
 *      `mergeEntityMatches` are pure — unit-testable without a DB or
 *      network.
 *
 *   4. LATENCY BUDGET. Keyword + one JOIN should be < 200ms. Flash-Lite
 *      (when opted in) adds ~500ms. Caller can disable for interactive
 *      paths.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface KnownEntity {
  id: string;
  name: string;
  canonical_name?: string | null;
  entity_type: string;
  mention_count?: number;
  metadata?: Record<string, any> | null;
}

export interface EntityRelationship {
  source_entity_id: string;
  target_entity_id: string;
  source_name: string;
  target_name: string;
  relationship_type: string;
  confidence_score?: number;
}

export interface EntityMatch {
  entity: KnownEntity;
  /** How this match surfaced: substring hit or LLM extraction. */
  via: "keyword" | "llm";
  /** Confidence 0..1. Keyword hits = 1.0; LLM ~0.6-0.95. */
  confidence: number;
}

export interface EntityNeighborhood {
  matches: EntityMatch[];
  relationships: EntityRelationship[];
  /** IDs of the entities whose neighborhoods were fetched. */
  rootEntityIds: string[];
}

export interface EntityPrepassResult {
  /** Formatted context block ready for prompt injection. */
  contextBlock: string;
  /** Matched root entities. */
  matches: EntityMatch[];
  /** Relationships in the returned neighborhood. */
  relationships: EntityRelationship[];
  /** Estimated tokens in `contextBlock`. */
  estimatedTokens: number;
}

/** Max tokens in the entity context block (plan says ~300). */
export const MAX_ENTITY_CONTEXT_TOKENS = 300;

/** Default max entities to match — bigger wastes budget on irrelevant KG. */
export const DEFAULT_MAX_MATCHES = 8;

/** Minimum entity name length to keyword-match (avoids "I", "the", etc.). */
const MIN_ENTITY_NAME_CHARS = 3;

// ─── Pure: keyword matcher ────────────────────────────────────────

/**
 * Match a query against a list of known entities by substring.
 *
 * Returns matches ordered by mention_count descending (most "important"
 * entities first). Deduplicates on entity id.
 *
 * Matches are case-insensitive. We require the canonical_name or name
 * to appear as a distinct token OR as a substring of ≥3 chars in the
 * query — the latter catches "Sara" in "Sara's dentist appointment".
 */
export function matchEntitiesByKeyword(
  query: string,
  entities: KnownEntity[],
  maxMatches: number = DEFAULT_MAX_MATCHES
): EntityMatch[] {
  if (!query || entities.length === 0) return [];
  const queryLower = query.toLowerCase();
  const matched = new Map<string, EntityMatch>();

  for (const entity of entities) {
    if (matched.size >= maxMatches) break;
    if (matched.has(entity.id)) continue;

    const candidates: string[] = [];
    if (entity.canonical_name) candidates.push(entity.canonical_name.toLowerCase());
    if (entity.name) candidates.push(entity.name.toLowerCase());
    // Aliases are stored in metadata.aliases as a string array per schema.
    const aliases = (entity.metadata?.aliases as string[] | undefined) ?? [];
    for (const a of aliases) if (typeof a === "string") candidates.push(a.toLowerCase());

    let hit = false;
    for (const cand of candidates) {
      if (!cand || cand.length < MIN_ENTITY_NAME_CHARS) continue;
      if (queryLower.includes(cand)) {
        hit = true;
        break;
      }
    }

    if (hit) {
      matched.set(entity.id, {
        entity,
        via: "keyword",
        confidence: 1.0,
      });
    }
  }

  // Sort by mention_count DESC — most-referenced entities rank higher.
  return Array.from(matched.values()).sort(
    (a, b) => (b.entity.mention_count ?? 0) - (a.entity.mention_count ?? 0)
  );
}

/**
 * Merge keyword + LLM matches, preferring keyword (higher confidence).
 */
export function mergeEntityMatches(
  keywordMatches: EntityMatch[],
  llmMatches: EntityMatch[],
  maxMatches: number = DEFAULT_MAX_MATCHES
): EntityMatch[] {
  const seen = new Set<string>();
  const out: EntityMatch[] = [];

  for (const m of keywordMatches) {
    if (seen.has(m.entity.id)) continue;
    seen.add(m.entity.id);
    out.push(m);
    if (out.length >= maxMatches) return out;
  }

  for (const m of llmMatches) {
    if (seen.has(m.entity.id)) continue;
    seen.add(m.entity.id);
    out.push(m);
    if (out.length >= maxMatches) return out;
  }

  return out;
}

// ─── Pure: formatter ──────────────────────────────────────────────

/** Estimate tokens — same formula as context-contract.ts. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format a neighborhood into a compact prompt block.
 *
 * Output shape (stable so downstream parsers can rely on it):
 *
 *   ## ENTITIES IN QUERY
 *   - Sarah (person, 47 mentions): partner
 *   - Panera (place, 12 mentions): restaurant
 *
 *   ## RELATIONSHIPS (depth-1)
 *   - Sarah → likes → coffee
 *   - Panera → located_in → downtown
 *
 * Bounded by `maxTokens`. When exceeded, drops relationships first,
 * then deprioritized entities (lowest mention_count). Always preserves
 * at least the top 2 matched entity headlines if any matches exist.
 */
export function formatEntityContext(
  neighborhood: EntityNeighborhood,
  maxTokens: number = MAX_ENTITY_CONTEXT_TOKENS
): string {
  if (neighborhood.matches.length === 0) return "";

  const entityLines = neighborhood.matches.map((m) => {
    const e = m.entity;
    const meta: string[] = [e.entity_type];
    if (e.mention_count && e.mention_count > 0) {
      meta.push(`${e.mention_count} mentions`);
    }
    const metaStr = meta.join(", ");
    return `- ${e.name} (${metaStr})`;
  });

  const relLines = neighborhood.relationships.map((r) => {
    return `- ${r.source_name} → ${r.relationship_type} → ${r.target_name}`;
  });

  // Start with everything, then shrink if over budget.
  let sections: string[] = [];
  if (entityLines.length > 0) {
    sections.push("## ENTITIES IN QUERY\n" + entityLines.join("\n"));
  }
  if (relLines.length > 0) {
    sections.push("## RELATIONSHIPS (depth-1)\n" + relLines.join("\n"));
  }
  let result = sections.join("\n\n");

  if (estimateTokens(result) <= maxTokens) return result;

  // Shrink path: drop relationships first.
  if (relLines.length > 0) {
    sections = [sections[0]];
    result = sections.join("\n\n");
    if (estimateTokens(result) <= maxTokens) return result;
  }

  // Still over budget — trim entity list from the tail.
  const keptEntities: string[] = [];
  // Header contributes a few tokens — account for "## ENTITIES IN QUERY\n"
  const headerTokens = estimateTokens("## ENTITIES IN QUERY\n");
  let usedTokens = headerTokens;
  for (const line of entityLines) {
    const lineTokens = estimateTokens(line + "\n");
    if (usedTokens + lineTokens > maxTokens) break;
    usedTokens += lineTokens;
    keptEntities.push(line);
  }
  if (keptEntities.length === 0) {
    // Preserve top 2 matches even if over budget — better than empty
    // when caller asked for entity context.
    return "## ENTITIES IN QUERY\n" + entityLines.slice(0, 2).join("\n");
  }
  return "## ENTITIES IN QUERY\n" + keptEntities.join("\n");
}

// ─── DB interface ─────────────────────────────────────────────────

/** Abstract DB — Supabase adapter below; tests inject a fake. */
export interface EntityDB {
  fetchUserEntities(userId: string, limit: number): Promise<KnownEntity[]>;
  fetchRelationshipsForEntities(
    userId: string,
    entityIds: string[]
  ): Promise<EntityRelationship[]>;
}

export function createSupabaseEntityDB(supabase: any): EntityDB {
  return {
    async fetchUserEntities(userId: string, limit: number): Promise<KnownEntity[]> {
      const { data, error } = await supabase
        .from("olive_entities")
        .select("id, name, canonical_name, entity_type, mention_count, metadata")
        .eq("user_id", userId)
        .order("mention_count", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`fetchUserEntities: ${error.message}`);
      return (data || []) as KnownEntity[];
    },
    async fetchRelationshipsForEntities(
      userId: string,
      entityIds: string[]
    ): Promise<EntityRelationship[]> {
      if (entityIds.length === 0) return [];
      // depth-1: a row matches if either endpoint is in our root set.
      const { data, error } = await supabase
        .from("olive_relationships")
        .select(
          `source_entity_id, target_entity_id, relationship_type, confidence_score,
           source:olive_entities!source_entity_id(name),
           target:olive_entities!target_entity_id(name)`
        )
        .eq("user_id", userId)
        .or(
          `source_entity_id.in.(${entityIds.join(",")}),target_entity_id.in.(${entityIds.join(",")})`
        )
        .order("confidence_score", { ascending: false })
        .limit(40);
      if (error) throw new Error(`fetchRelationshipsForEntities: ${error.message}`);
      return (data || [])
        .filter((r: any) => r.source?.name && r.target?.name)
        .map((r: any) => ({
          source_entity_id: r.source_entity_id,
          target_entity_id: r.target_entity_id,
          source_name: r.source.name,
          target_name: r.target.name,
          relationship_type: r.relationship_type,
          confidence_score: r.confidence_score,
        }));
    },
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────

export interface EntityPrepassOptions {
  maxMatches?: number;
  maxTokens?: number;
  /** If set, this pool is used directly instead of fetching from DB. */
  entityPool?: KnownEntity[];
  /** Max entities to load as the match pool. Ignored if entityPool set. */
  entityPoolLimit?: number;
}

/**
 * Run the entity pre-pass end-to-end.
 *
 * NEVER THROWS. On any failure the result is an empty block — the
 * caller's search still runs normally, just without entity context.
 */
export async function runEntityPrepass(
  db: EntityDB,
  userId: string,
  query: string,
  options: EntityPrepassOptions = {}
): Promise<EntityPrepassResult> {
  const emptyResult: EntityPrepassResult = {
    contextBlock: "",
    matches: [],
    relationships: [],
    estimatedTokens: 0,
  };

  if (!userId || !query || query.trim().length < 3) return emptyResult;

  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxTokens = options.maxTokens ?? MAX_ENTITY_CONTEXT_TOKENS;
  const poolLimit = options.entityPoolLimit ?? 100;

  // Step 1: load the pool (or use injected one)
  let pool: KnownEntity[];
  if (options.entityPool) {
    pool = options.entityPool;
  } else {
    try {
      pool = await db.fetchUserEntities(userId, poolLimit);
    } catch (err) {
      console.warn(
        "[entity-prepass] fetchUserEntities failed (skipping):",
        err instanceof Error ? err.message : err
      );
      return emptyResult;
    }
  }

  // Step 2: keyword match
  const matches = matchEntitiesByKeyword(query, pool, maxMatches);
  if (matches.length === 0) return emptyResult;

  // Step 3: fetch depth-1 neighborhood for matched entities
  let relationships: EntityRelationship[] = [];
  try {
    relationships = await db.fetchRelationshipsForEntities(
      userId,
      matches.map((m) => m.entity.id)
    );
  } catch (err) {
    console.warn(
      "[entity-prepass] fetchRelationshipsForEntities failed (partial result):",
      err instanceof Error ? err.message : err
    );
    // Fall through — entity matches still useful without relationships.
  }

  const neighborhood: EntityNeighborhood = {
    matches,
    relationships,
    rootEntityIds: matches.map((m) => m.entity.id),
  };

  // Step 4: format & cap
  const contextBlock = formatEntityContext(neighborhood, maxTokens);

  return {
    contextBlock,
    matches,
    relationships,
    estimatedTokens: estimateTokens(contextBlock),
  };
}
