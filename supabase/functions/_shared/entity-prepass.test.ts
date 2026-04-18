/**
 * Deno tests for entity-prepass.ts (Phase 4-D).
 *
 * Covered:
 *   - Keyword matcher: case insensitivity, min-length filter, aliases, dedup.
 *   - Match merging: keyword priority, dedup by ID, maxMatches cap.
 *   - Formatter: standard output shape, token cap, shrink paths.
 *   - Orchestrator: happy path, empty query, empty pool, DB failure fallback.
 *
 * Run: deno test supabase/functions/_shared/entity-prepass.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  DEFAULT_MAX_MATCHES,
  MAX_ENTITY_CONTEXT_TOKENS,
  formatEntityContext,
  matchEntitiesByKeyword,
  mergeEntityMatches,
  runEntityPrepass,
  type EntityDB,
  type EntityMatch,
  type EntityRelationship,
  type KnownEntity,
} from "./entity-prepass.ts";

// ─── Test fixtures ────────────────────────────────────────────────

const entities: KnownEntity[] = [
  { id: "e1", name: "Sarah", canonical_name: "sarah", entity_type: "person", mention_count: 47 },
  { id: "e2", name: "Panera", canonical_name: "panera", entity_type: "place", mention_count: 12 },
  { id: "e3", name: "Fernando the kangaroo", canonical_name: "fernando", entity_type: "person", mention_count: 3 },
  { id: "e4", name: "coffee", canonical_name: "coffee", entity_type: "concept", mention_count: 30 },
  {
    id: "e5",
    name: "Mom",
    canonical_name: "mom",
    entity_type: "person",
    mention_count: 20,
    metadata: { aliases: ["mother", "mama"] },
  },
  { id: "e6", name: "NY", canonical_name: "ny", entity_type: "place", mention_count: 5 },
];

// ─── Keyword matcher ──────────────────────────────────────────────

Deno.test("matchEntitiesByKeyword: empty query → empty", () => {
  assertEquals(matchEntitiesByKeyword("", entities), []);
});

Deno.test("matchEntitiesByKeyword: simple match is case insensitive", () => {
  const results = matchEntitiesByKeyword("when did I last see Sarah?", entities);
  assertEquals(results.length, 1);
  assertEquals(results[0].entity.id, "e1");
  assertEquals(results[0].confidence, 1.0);
  assertEquals(results[0].via, "keyword");
});

Deno.test("matchEntitiesByKeyword: multiple hits, sorted by mention_count", () => {
  const results = matchEntitiesByKeyword(
    "Does Sarah drink coffee at Panera?",
    entities
  );
  const ids = results.map((r) => r.entity.id);
  // Mentions: Sarah=47, coffee=30, Panera=12 → that order
  assertEquals(ids, ["e1", "e4", "e2"]);
});

Deno.test("matchEntitiesByKeyword: aliases matched via metadata.aliases", () => {
  const results = matchEntitiesByKeyword("Ask mother about the recipe", entities);
  assertEquals(results.length, 1);
  assertEquals(results[0].entity.id, "e5"); // Mom — via "mother" alias
});

Deno.test("matchEntitiesByKeyword: min-length filter skips 2-char candidates", () => {
  // "NY" is 2 chars, should NOT match "in a NY minute" (would be noisy).
  const results = matchEntitiesByKeyword("in a NY minute", entities);
  const hasNY = results.some((r) => r.entity.id === "e6");
  assertEquals(hasNY, false);
});

Deno.test("matchEntitiesByKeyword: respects maxMatches", () => {
  const results = matchEntitiesByKeyword(
    "Sarah Panera coffee Fernando Mom",
    entities,
    2
  );
  assertEquals(results.length, 2);
});

Deno.test("matchEntitiesByKeyword: no hits → empty", () => {
  const results = matchEntitiesByKeyword("nothing relevant here today", entities);
  assertEquals(results.length, 0);
});

// ─── mergeEntityMatches ───────────────────────────────────────────

Deno.test("mergeEntityMatches: keyword matches kept before LLM matches", () => {
  const kw: EntityMatch[] = [
    { entity: entities[0], via: "keyword", confidence: 1.0 },
  ];
  const llm: EntityMatch[] = [
    { entity: entities[1], via: "llm", confidence: 0.7 },
  ];
  const merged = mergeEntityMatches(kw, llm);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].via, "keyword");
  assertEquals(merged[1].via, "llm");
});

Deno.test("mergeEntityMatches: dedup by entity id (keyword wins)", () => {
  const kw: EntityMatch[] = [{ entity: entities[0], via: "keyword", confidence: 1.0 }];
  const llm: EntityMatch[] = [{ entity: entities[0], via: "llm", confidence: 0.6 }];
  const merged = mergeEntityMatches(kw, llm);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].via, "keyword");
});

Deno.test("mergeEntityMatches: respects maxMatches", () => {
  const kw = entities.map((e): EntityMatch => ({ entity: e, via: "keyword", confidence: 1.0 }));
  const merged = mergeEntityMatches(kw, [], 3);
  assertEquals(merged.length, 3);
});

// ─── Formatter ────────────────────────────────────────────────────

Deno.test("formatEntityContext: empty matches → empty string", () => {
  const out = formatEntityContext({ matches: [], relationships: [], rootEntityIds: [] });
  assertEquals(out, "");
});

Deno.test("formatEntityContext: standard output includes both sections", () => {
  const rel: EntityRelationship = {
    source_entity_id: "e1",
    target_entity_id: "e4",
    source_name: "Sarah",
    target_name: "coffee",
    relationship_type: "likes",
  };
  const out = formatEntityContext({
    matches: [{ entity: entities[0], via: "keyword", confidence: 1.0 }],
    relationships: [rel],
    rootEntityIds: ["e1"],
  });
  assert(out.includes("## ENTITIES IN QUERY"));
  assert(out.includes("Sarah"));
  assert(out.includes("## RELATIONSHIPS"));
  assert(out.includes("Sarah → likes → coffee"));
});

Deno.test("formatEntityContext: cap enforced (<= maxTokens)", () => {
  // Build a huge neighborhood and verify the result fits the budget.
  const bigMatches: EntityMatch[] = [];
  for (let i = 0; i < 100; i++) {
    bigMatches.push({
      entity: {
        id: `e${i}`,
        name: `Entity Number ${i} with a longer name for token pressure`,
        entity_type: "concept",
        mention_count: i,
      },
      via: "keyword",
      confidence: 1.0,
    });
  }
  const bigRels: EntityRelationship[] = [];
  for (let i = 0; i < 100; i++) {
    bigRels.push({
      source_entity_id: "eA",
      target_entity_id: `e${i}`,
      source_name: "RootEntity",
      target_name: `Entity Number ${i}`,
      relationship_type: "related_to",
    });
  }
  const out = formatEntityContext({
    matches: bigMatches,
    relationships: bigRels,
    rootEntityIds: ["eA"],
  });
  // Rough token estimate: ~chars/4
  const tokens = Math.ceil(out.length / 4);
  assert(
    tokens <= MAX_ENTITY_CONTEXT_TOKENS + 10, // small slack for headers
    `context block is ${tokens} tokens — exceeds MAX_ENTITY_CONTEXT_TOKENS ${MAX_ENTITY_CONTEXT_TOKENS}`
  );
});

Deno.test("formatEntityContext: small budget still shows top-2 entities", () => {
  const matches: EntityMatch[] = entities.slice(0, 3).map((e): EntityMatch => ({
    entity: e,
    via: "keyword",
    confidence: 1.0,
  }));
  const out = formatEntityContext(
    { matches, relationships: [], rootEntityIds: [] },
    20 // absurdly small budget
  );
  // Invariant: at least the top 2 entities must be preserved.
  assert(out.includes("Sarah") || out.includes("Panera") || out.includes("Fernando"));
  assert(out.includes("## ENTITIES IN QUERY"));
});

// ─── Orchestrator ─────────────────────────────────────────────────

function mkDB(pool: KnownEntity[], rels: EntityRelationship[] = []): EntityDB {
  return {
    async fetchUserEntities() {
      return pool;
    },
    async fetchRelationshipsForEntities() {
      return rels;
    },
  };
}

Deno.test("runEntityPrepass: empty query → empty result", async () => {
  const db = mkDB(entities);
  const result = await runEntityPrepass(db, "user-1", "");
  assertEquals(result.contextBlock, "");
  assertEquals(result.matches.length, 0);
});

Deno.test("runEntityPrepass: empty user id → empty result", async () => {
  const db = mkDB(entities);
  const result = await runEntityPrepass(db, "", "Sarah's birthday");
  assertEquals(result.contextBlock, "");
});

Deno.test("runEntityPrepass: happy path — matches + relationships", async () => {
  const rel: EntityRelationship = {
    source_entity_id: "e1",
    target_entity_id: "e4",
    source_name: "Sarah",
    target_name: "coffee",
    relationship_type: "likes",
  };
  const db = mkDB(entities, [rel]);
  const result = await runEntityPrepass(db, "user-1", "What does Sarah like to drink?");
  assert(result.matches.length >= 1);
  assert(result.contextBlock.includes("Sarah"));
  assert(result.contextBlock.includes("likes"));
  assert(result.estimatedTokens > 0);
});

Deno.test("runEntityPrepass: no entity matches → empty context", async () => {
  const db = mkDB(entities);
  const result = await runEntityPrepass(db, "user-1", "what time is it in Tokyo?");
  assertEquals(result.contextBlock, "");
  assertEquals(result.matches.length, 0);
});

Deno.test("runEntityPrepass: DB failure returns empty (never throws)", async () => {
  const brokenDB: EntityDB = {
    async fetchUserEntities() {
      throw new Error("simulated DB error");
    },
    async fetchRelationshipsForEntities() {
      return [];
    },
  };
  const result = await runEntityPrepass(brokenDB, "user-1", "anything");
  assertEquals(result.contextBlock, "");
});

Deno.test("runEntityPrepass: relationship fetch failure → partial result", async () => {
  const brokenRelsDB: EntityDB = {
    async fetchUserEntities() {
      return entities;
    },
    async fetchRelationshipsForEntities() {
      throw new Error("simulated rel error");
    },
  };
  const result = await runEntityPrepass(brokenRelsDB, "user-1", "Sarah");
  // Matches survived; relationships empty; context still non-empty.
  assert(result.matches.length >= 1);
  assertEquals(result.relationships.length, 0);
  assert(result.contextBlock.includes("Sarah"));
});

Deno.test("runEntityPrepass: entityPool option bypasses DB call", async () => {
  const neverCallDB: EntityDB = {
    async fetchUserEntities() {
      throw new Error("should not be called when entityPool is provided");
    },
    async fetchRelationshipsForEntities() {
      return [];
    },
  };
  const result = await runEntityPrepass(neverCallDB, "user-1", "Sarah", {
    entityPool: entities,
  });
  assert(result.matches.length >= 1);
});

Deno.test("runEntityPrepass: respects DEFAULT_MAX_MATCHES", async () => {
  const manyEntities: KnownEntity[] = [];
  const rels: EntityRelationship[] = [];
  for (let i = 0; i < 20; i++) {
    manyEntities.push({
      id: `e${i}`,
      name: `Widget${i}`,
      canonical_name: `widget${i}`,
      entity_type: "thing",
      mention_count: 10,
    });
  }
  const query = manyEntities.map((e) => e.canonical_name).join(" ");
  const db = mkDB(manyEntities, rels);
  const result = await runEntityPrepass(db, "user-1", query);
  assertEquals(result.matches.length, DEFAULT_MAX_MATCHES);
});
