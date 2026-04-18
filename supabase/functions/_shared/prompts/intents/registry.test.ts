/**
 * Deno tests for per-intent prompt registry (Phase 4-C).
 *
 * Verifies:
 *   - Every intent resolves to the right module.
 *   - Unknown intents fall back to the chat module (no undefined).
 *   - Case and whitespace are normalized.
 *   - Aliases map to sensible targets.
 *   - Every module fits its per-slot token budget.
 *   - `system_core` is identical across modules (prompt-cache invariant).
 *
 * Run: deno test supabase/functions/_shared/prompts/intents/registry.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  allModules,
  loadPromptModule,
  resolveIntentKey,
} from "./registry.ts";
import { SYSTEM_CORE_V1 } from "./system-core.ts";
import { estimateTokens } from "../../context-contract.ts";

// ─── Resolver ─────────────────────────────────────────────────────

Deno.test("resolveIntentKey: canonical intents resolve to themselves", () => {
  assertEquals(resolveIntentKey("chat"), "chat");
  assertEquals(resolveIntentKey("contextual_ask"), "contextual_ask");
  assertEquals(resolveIntentKey("create"), "create");
  assertEquals(resolveIntentKey("search"), "search");
  assertEquals(resolveIntentKey("expense"), "expense");
  assertEquals(resolveIntentKey("task_action"), "task_action");
  assertEquals(resolveIntentKey("partner_message"), "partner_message");
});

Deno.test("resolveIntentKey: case-insensitive", () => {
  assertEquals(resolveIntentKey("CHAT"), "chat");
  assertEquals(resolveIntentKey("Create"), "create");
});

Deno.test("resolveIntentKey: whitespace tolerated", () => {
  assertEquals(resolveIntentKey("  search  "), "search");
});

Deno.test("resolveIntentKey: unknown intent falls back to default", () => {
  assertEquals(resolveIntentKey("not_a_real_intent"), "default");
  assertEquals(resolveIntentKey(""), "default");
  assertEquals(resolveIntentKey(null), "default");
  assertEquals(resolveIntentKey(undefined), "default");
});

Deno.test("resolveIntentKey: classifier aliases land on sensible targets", () => {
  assertEquals(resolveIntentKey("web_search"), "search");
  assertEquals(resolveIntentKey("merge"), "task_action");
  assertEquals(resolveIntentKey("list_recap"), "search");
  assertEquals(resolveIntentKey("create_list"), "create");
  assertEquals(resolveIntentKey("save_artifact"), "create");
});

// ─── Loader ───────────────────────────────────────────────────────

Deno.test("loadPromptModule: every canonical intent returns a module", () => {
  for (const intent of [
    "chat",
    "contextual_ask",
    "create",
    "search",
    "expense",
    "task_action",
    "partner_message",
  ]) {
    const mod = loadPromptModule(intent);
    assertEquals(mod.intent, intent);
    assert(mod.system_core.length > 0, `${intent} has empty system_core`);
    assert(mod.intent_rules.length > 0, `${intent} has empty intent_rules`);
    // Versions use hyphens in identifiers ("contextual-ask-intent-v1.0")
    // while intent keys use underscores ("contextual_ask") — normalize
    // both sides before checking the prefix.
    const expectedPrefix = intent.replace(/_/g, "-") + "-intent-v";
    assert(
      mod.version.startsWith(expectedPrefix),
      `${intent} has malformed version: ${mod.version} (expected prefix ${expectedPrefix})`
    );
  }
});

Deno.test("loadPromptModule: unknown intent → chat fallback (never throws)", () => {
  const mod = loadPromptModule("wonderland");
  assertEquals(mod.intent, "chat");
});

Deno.test("loadPromptModule: null/empty inputs safe", () => {
  const a = loadPromptModule(null);
  const b = loadPromptModule(undefined);
  const c = loadPromptModule("");
  assertEquals(a.intent, "chat");
  assertEquals(b.intent, "chat");
  assertEquals(c.intent, "chat");
});

// ─── Budget invariants (ties into Context Contract) ──────────────

Deno.test("invariant: system_core stays within 200 tokens (IDENTITY slot)", () => {
  const tokens = estimateTokens(SYSTEM_CORE_V1);
  assert(
    tokens <= 200,
    `SYSTEM_CORE_V1 is ${tokens} tokens — exceeds IDENTITY slot budget of 200`
  );
});

Deno.test("invariant: every intent_rules fits SLOT_INTENT_MODULE budget (250 tok)", () => {
  for (const mod of allModules()) {
    const tokens = estimateTokens(mod.intent_rules);
    assert(
      tokens <= 250,
      `${mod.intent}.intent_rules is ${tokens} tokens — exceeds 250`
    );
  }
});

Deno.test("invariant: few_shot_examples (when present) fit 250 tok budget", () => {
  for (const mod of allModules()) {
    if (!mod.few_shot_examples) continue;
    const tokens = estimateTokens(mod.few_shot_examples);
    assert(
      tokens <= 250,
      `${mod.intent}.few_shot_examples is ${tokens} tokens — exceeds 250`
    );
  }
});

Deno.test("invariant: system_core is IDENTICAL across modules (prompt cache)", () => {
  // If this fails, Phase 6 prompt caching will miss on every intent
  // switch. The cache prefix must be byte-identical.
  const cores = allModules().map((m) => m.system_core);
  const first = cores[0];
  for (const c of cores) {
    assertEquals(
      c,
      first,
      "system_core differs across modules — prompt-cache prefix broken"
    );
  }
});

Deno.test("invariant: all version strings are unique", () => {
  const versions = allModules().map((m) => m.version);
  const unique = new Set(versions);
  assertEquals(
    versions.length,
    unique.size,
    `duplicate version strings: ${versions.join(", ")}`
  );
});

Deno.test("allModules: returns the 7 canonical intents, deduplicated", () => {
  const mods = allModules();
  assertEquals(mods.length, 7);
  const intents = new Set(mods.map((m) => m.intent));
  assert(intents.has("chat"));
  assert(intents.has("contextual_ask"));
  assert(intents.has("create"));
  assert(intents.has("search"));
  assert(intents.has("expense"));
  assert(intents.has("task_action"));
  assert(intents.has("partner_message"));
});
