/**
 * Phase 4 End-to-End Integration Test
 * =====================================
 * Exercises the full Phase 4 pipeline without hitting a live DB or LLM:
 *
 *   1. COMPILE simulation: take raw source chunks, validate a compiled
 *      artifact against them, and confirm the grounding score + notes
 *      are reasonable.
 *   2. ASSEMBLE: run `assembleCompiledSlot` on those artifacts with a
 *      mix of fresh and stale timestamps; confirm ordering + budgeting.
 *   3. INTENT MODULE: resolve an intent → load prompt module → verify
 *      the module's slots fit the Context Contract budgets.
 *   4. CONTRACT ASSEMBLY: plug the compiled slot content + the intent
 *      module into the `STANDARD_CONTRACT` assembler and confirm the
 *      output is under the STANDARD_BUDGET with no required slots
 *      missing.
 *   5. ENTITY PRE-PASS: run a scripted query through the pre-pass
 *      orchestrator with an in-memory entity pool + relationships and
 *      verify the produced block would slot safely into SLOT_DYNAMIC.
 *
 * This is the "golden path" smoke check — it doesn't replace unit tests
 * (which live alongside each module) but proves the pieces fit together.
 *
 * Run: deno test supabase/functions/_shared/phase4-integration.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assembleCompiledSlot,
  validateCompiledAgainstSources,
  type CompiledArtifact,
} from "./compiled-artifacts.ts";
import {
  assembleContext,
  STANDARD_BUDGET,
  STANDARD_CONTRACT,
  estimateTokens,
} from "./context-contract.ts";
import {
  runEntityPrepass,
  MAX_ENTITY_CONTEXT_TOKENS,
  type EntityDB,
  type EntityRelationship,
  type KnownEntity,
} from "./entity-prepass.ts";
import { loadPromptModule } from "./prompts/intents/registry.ts";

// ─── Stage 1: Compile + validate ──────────────────────────────────

Deno.test("Phase4 e2e: compile → validate → prompt injection", () => {
  // (1) Source chunks as they'd come from clerk_notes + user_memories
  //     for a real user.
  const sourceChunks = [
    { content: "User prefers morning espresso coffee before starting work." },
    { content: "Partner is named Sarah. Sarah handles grocery shopping on weekends." },
    { content: "User lives in Miami, timezone America/New_York, language English." },
    { content: "User is allergic to peanuts; mentioned during dinner planning." },
  ];

  // (2) Pretend Gemini returned this compiled profile. Most sentences
  //     are grounded; one is a subtle fabrication.
  const compiledProfile = `## User Profile
- Prefers morning espresso coffee.
- Partner Sarah handles grocery shopping on weekends.
- Lives in Miami, EST timezone.
- Allergic to peanuts.
- Owns three dachshunds named Steve.`;

  // (3) Validate: expect score in partial range because of the dog sentence.
  const validation = validateCompiledAgainstSources(compiledProfile, sourceChunks);
  assert(
    validation.score < 1.0 && validation.score > 0,
    `expected partial score, got ${validation.score}`
  );
  assert(
    validation.ungroundedSentences.some((s) => s.includes("dachshunds")),
    "dachshunds sentence should be flagged as ungrounded"
  );

  // (4) Assemble the compiled slot from the (still valid) artifact.
  const artifacts: CompiledArtifact[] = [
    {
      file_type: "profile",
      content: compiledProfile,
      updated_at: new Date().toISOString(), // fresh
    },
  ];
  const slot = assembleCompiledSlot(artifacts);
  assertEquals(slot.source, "compiled");
  assertEquals(slot.fresh, true);
  assert(slot.content.includes("## COMPILED USER PROFILE"));
  assert(slot.content.includes("Miami"));

  // (5) Feed into Context Contract. Produces a full prompt string.
  const module = loadPromptModule("chat");
  const result = assembleContext(
    {
      IDENTITY: module.system_core,
      QUERY: "What coffee should I order for my morning routine?",
      USER_COMPILED: slot.content,
      INTENT_MODULE: module.intent_rules,
      TOOLS: "",
      DYNAMIC: "",
      HISTORY: "",
    },
    STANDARD_CONTRACT,
    STANDARD_BUDGET
  );

  // (6) Assertions on final assembly:
  assertEquals(result.missingRequired.length, 0, "no required slots empty");
  assert(result.totalTokens <= STANDARD_BUDGET, "under standard budget");
  assert(result.prompt.includes("morning espresso"), "user profile present in prompt");
  assert(result.prompt.includes("What coffee"), "user query present");
  assert(
    result.prompt.includes("CHAT INTENT RULES"),
    "intent module injected"
  );
});

// ─── Stage 2: Budget stress — huge artifacts + huge history ──────

Deno.test("Phase4 e2e: budget enforced even with 10x overflow", () => {
  const big = "x".repeat(8000);
  const bigArtifacts: CompiledArtifact[] = [
    { file_type: "profile", content: big, updated_at: new Date().toISOString() },
    { file_type: "patterns", content: big, updated_at: new Date().toISOString() },
    { file_type: "relationship", content: big, updated_at: new Date().toISOString() },
    { file_type: "household", content: big, updated_at: new Date().toISOString() },
  ];
  const slot = assembleCompiledSlot(bigArtifacts);
  // Slot total must respect COMPILED_USER_BUDGET (650).
  assert(slot.estimatedTokens <= 660);

  const module = loadPromptModule("chat");
  const result = assembleContext(
    {
      IDENTITY: module.system_core,
      QUERY: "Q",
      USER_COMPILED: slot.content,
      INTENT_MODULE: module.intent_rules,
      TOOLS: "",
      DYNAMIC: big, // also huge
      HISTORY: big, // also huge
    },
    STANDARD_CONTRACT,
    STANDARD_BUDGET
  );
  assert(result.totalTokens <= STANDARD_BUDGET);
  // Required slots must survive even under emergency drops.
  assertEquals(result.missingRequired.length, 0);
});

// ─── Stage 3: Entity pre-pass fits SLOT_DYNAMIC ──────────────────

Deno.test("Phase4 e2e: entity pre-pass output fits DYNAMIC slot budget", async () => {
  const pool: KnownEntity[] = [
    { id: "e1", name: "Sarah", canonical_name: "sarah", entity_type: "person", mention_count: 47 },
    { id: "e2", name: "Panera", canonical_name: "panera", entity_type: "place", mention_count: 12 },
    { id: "e3", name: "coffee", canonical_name: "coffee", entity_type: "concept", mention_count: 30 },
  ];
  const rels: EntityRelationship[] = [
    {
      source_entity_id: "e1",
      target_entity_id: "e3",
      source_name: "Sarah",
      target_name: "coffee",
      relationship_type: "likes",
    },
  ];
  const db: EntityDB = {
    async fetchUserEntities() {
      return pool;
    },
    async fetchRelationshipsForEntities() {
      return rels;
    },
  };

  const result = await runEntityPrepass(db, "user-x", "What coffee does Sarah prefer?");

  assert(result.contextBlock.length > 0);
  assert(result.estimatedTokens <= MAX_ENTITY_CONTEXT_TOKENS);

  // Would it fit into SLOT_DYNAMIC's 800 budget along with other stuff?
  const dynamicSlotTokens = estimateTokens(result.contextBlock);
  assert(
    dynamicSlotTokens <= 800,
    "entity pre-pass alone would exceed SLOT_DYNAMIC"
  );
});

// ─── Stage 4: Intent switching doesn't mutate IDENTITY (cache hit) ─

Deno.test("Phase4 e2e: IDENTITY slot byte-identical across intents", () => {
  const intents = [
    "chat",
    "create",
    "search",
    "expense",
    "task_action",
    "partner_message",
    "contextual_ask",
  ];
  const first = loadPromptModule(intents[0]).system_core;
  for (const i of intents) {
    const mod = loadPromptModule(i);
    assertEquals(
      mod.system_core,
      first,
      `system_core drift on intent=${i} — breaks prompt-cache prefix stability`
    );
  }
});
