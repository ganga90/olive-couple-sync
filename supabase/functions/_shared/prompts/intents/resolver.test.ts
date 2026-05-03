/**
 * Deno tests for the feature-flagged prompt resolver.
 *
 * Covered:
 *   - `hashUserToBucket`: determinism, range, stable across runs.
 *   - `decidePromptSource`: flag precedence matrix (ON/OFF/unset × rollout
 *     pct 0/50/100/out-of-range × userId present/absent).
 *   - `resolvePrompt`: legacy and modular paths, telemetry shape,
 *     alias resolution via registry, graceful handling of missing inputs.
 *
 * Run: deno test supabase/functions/_shared/prompts/intents/resolver.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  decidePromptSource,
  hashUserToBucket,
  resolvePrompt,
} from "./resolver.ts";

// ─── Hash function ────────────────────────────────────────────────

Deno.test("hashUserToBucket: deterministic for same input", () => {
  const a = hashUserToBucket("user-123");
  const b = hashUserToBucket("user-123");
  assertEquals(a, b);
});

Deno.test("hashUserToBucket: result in [0, 100)", () => {
  for (const id of ["a", "user-1", "user-2", "very-long-id-abc-def-ghi-jkl", "xx"]) {
    const bucket = hashUserToBucket(id);
    assert(bucket >= 0 && bucket < 100, `bucket ${bucket} out of range for "${id}"`);
  }
});

Deno.test("hashUserToBucket: empty string returns 0", () => {
  assertEquals(hashUserToBucket(""), 0);
});

Deno.test("hashUserToBucket: distribution spreads across buckets", () => {
  // Sanity: 1000 distinct ids should not all land in the same bucket.
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    seen.add(hashUserToBucket(`user-${i}`));
  }
  assert(seen.size > 10, `only ${seen.size} unique buckets for 1000 ids — distribution looks broken`);
});

// ─── decidePromptSource policy ────────────────────────────────────

Deno.test("decidePromptSource: USE_INTENT_MODULES=1 → modular (any user)", () => {
  assertEquals(decidePromptSource("u", "1", undefined), "modular");
  assertEquals(decidePromptSource("u", "true", undefined), "modular");
  assertEquals(decidePromptSource("u", "ON", undefined), "modular");
  assertEquals(decidePromptSource("u", "yes", undefined), "modular");
  // Even with empty userId.
  assertEquals(decidePromptSource("", "1", undefined), "modular");
});

Deno.test("decidePromptSource: flag=0 → legacy (even if rollout>0)", () => {
  assertEquals(decidePromptSource("u", "0", "100"), "legacy");
  assertEquals(decidePromptSource("u", "false", "50"), "legacy");
  assertEquals(decidePromptSource("u", "off", "99"), "legacy");
});

Deno.test("decidePromptSource: flag unset + rollout=0 → legacy", () => {
  assertEquals(decidePromptSource("u", undefined, "0"), "legacy");
  assertEquals(decidePromptSource("u", undefined, undefined), "legacy");
});

Deno.test("decidePromptSource: flag unset + rollout=100 → modular", () => {
  assertEquals(decidePromptSource("u", undefined, "100"), "modular");
  assertEquals(decidePromptSource("anyone", undefined, "100"), "modular");
});

Deno.test("decidePromptSource: flag unset + rollout=50 → bucket-dependent", () => {
  // Without userId we can't hash, so we stay on legacy (conservative).
  assertEquals(decidePromptSource("", undefined, "50"), "legacy");
  assertEquals(decidePromptSource(null, undefined, "50"), "legacy");

  // With ids, some should land modular and some legacy — verify both exist.
  let modularSeen = false;
  let legacySeen = false;
  for (let i = 0; i < 500 && !(modularSeen && legacySeen); i++) {
    const result = decidePromptSource(`u-${i}`, undefined, "50");
    if (result === "modular") modularSeen = true;
    else legacySeen = true;
  }
  assert(modularSeen, "no users landed in modular bucket at 50%");
  assert(legacySeen, "no users landed in legacy bucket at 50%");
});

Deno.test("decidePromptSource: rollout pct clamped to [0, 100]", () => {
  // Negative + over-max both coerced to valid range.
  assertEquals(decidePromptSource("u", undefined, "-10"), "legacy");
  assertEquals(decidePromptSource("u", undefined, "999"), "modular");
});

Deno.test("decidePromptSource: garbage rollout pct treated as 0", () => {
  assertEquals(decidePromptSource("u", undefined, "not-a-number"), "legacy");
});

Deno.test("decidePromptSource: user bucket stability across calls", () => {
  // Same user at same rollout → same decision, always.
  const first = decidePromptSource("user-abc", undefined, "30");
  for (let i = 0; i < 50; i++) {
    assertEquals(decidePromptSource("user-abc", undefined, "30"), first);
  }
});

// ─── resolvePrompt orchestrator ───────────────────────────────────

function envWith(overrides: Record<string, string | undefined>) {
  return (key: string) => overrides[key];
}

Deno.test("resolvePrompt: flag OFF → returns legacy verbatim", () => {
  const r = resolvePrompt({
    intent: "chat",
    userId: "u-1",
    legacyPrompt: "LEGACY SYSTEM TEXT",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({}), // flag unset, rollout 0 → legacy
  });
  assertEquals(r.source, "legacy");
  assertEquals(r.systemInstruction, "LEGACY SYSTEM TEXT");
  assertEquals(r.intentRules, "");
  assertEquals(r.version, "chat-v1.0");
  assertEquals(r.resolvedIntent, "legacy");
});

Deno.test("resolvePrompt: flag=1 → returns modular (chat module)", () => {
  const r = resolvePrompt({
    intent: "chat",
    userId: "u-1",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  assertEquals(r.source, "modular");
  assert(r.systemInstruction.length > 0, "systemInstruction must be populated");
  assert(r.intentRules.includes("CHAT INTENT RULES"));
  assertEquals(r.version, "chat-intent-v1.0");
  assertEquals(r.resolvedIntent, "chat");
});

Deno.test("resolvePrompt: intent='help' → modular help_about_olive (alias)", () => {
  const r = resolvePrompt({
    intent: "help",
    userId: "u-1",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  assertEquals(r.source, "modular");
  assertEquals(r.resolvedIntent, "help_about_olive");
  assert(r.intentRules.includes("HELP_ABOUT_OLIVE"));
});

Deno.test("resolvePrompt: unknown intent in modular mode → chat fallback", () => {
  const r = resolvePrompt({
    intent: "wonderland",
    userId: "u-1",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  assertEquals(r.source, "modular");
  assertEquals(r.resolvedIntent, "chat");
});

Deno.test("resolvePrompt: rollout=100 without flag → modular", () => {
  const r = resolvePrompt({
    intent: "chat",
    userId: "u-1",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({ INTENT_MODULES_ROLLOUT_PCT: "100" }),
  });
  assertEquals(r.source, "modular");
});

Deno.test("resolvePrompt: flag=0 beats rollout=100 (explicit off)", () => {
  const r = resolvePrompt({
    intent: "chat",
    userId: "u-1",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({
      USE_INTENT_MODULES: "0",
      INTENT_MODULES_ROLLOUT_PCT: "100",
    }),
  });
  assertEquals(r.source, "legacy");
});

Deno.test("resolvePrompt: empty userId + rollout%=50 → legacy (conservative)", () => {
  const r = resolvePrompt({
    intent: "chat",
    userId: "",
    legacyPrompt: "LEGACY",
    legacyVersion: "chat-v1.0",
    envGetter: envWith({ INTENT_MODULES_ROLLOUT_PCT: "50" }),
  });
  assertEquals(r.source, "legacy");
});

Deno.test("resolvePrompt: never throws on null/undefined intent", () => {
  const r1 = resolvePrompt({
    intent: null,
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  assertEquals(r1.source, "modular");
  assertEquals(r1.resolvedIntent, "chat");

  const r2 = resolvePrompt({
    intent: undefined,
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  assertEquals(r2.source, "modular");
  assertEquals(r2.resolvedIntent, "chat");
});

// ─── Phase D-1 — resolvePromptAsync ────────────────────────────────
//
// New async variant that may apply a prompt-evolution addendum on top
// of the modular baseline. Pinned guarantees:
//
//   - When source=legacy, async return == sync return (unchanged)
//   - When supabase is missing, async return == sync return
//   - When userId is missing, async return == sync return
//   - When PROMPT_EVOLUTION_ROUTER_ENABLED is unset/false, async return
//     == sync return — even with supabase + userId provided
//   - When the router is enabled but no addendum exists, async return
//     == sync return (NEVER make the baseline worse)
//   - When an approved addendum exists, async return adds it: version
//     tagged + intent_rules extended
//   - DB errors are swallowed → fall back to baseline
//
// The first five guarantees collectively pin "live integration is
// safe to ship turned off" — production behavior is byte-identical
// until a flag flip + an approved addendum coincide.

import { resolvePromptAsync } from "./resolver.ts";

interface FakeSb {
  row: { id: string; addendum_text: string; status: string; rollout_pct: number } | null;
}
function makeSb(b: FakeSb) {
  return {
    from(_t: string) {
      const ret: any = {
        select: (_c: string) => ret,
        eq: (_c: string, _v: unknown) => ret,
        in: (_c: string, _v: unknown) => ret,
        order: (_c: string, _o: unknown) => ret,
        limit: (_n: number) => ret,
        maybeSingle: async () => ({ data: b.row, error: null }),
      };
      return ret;
    },
  };
}

Deno.test("resolvePromptAsync: legacy source → identical to sync", async () => {
  const input = {
    intent: "chat",
    userId: "u_test",
    legacyPrompt: "LEGACY",
    legacyVersion: "v0",
    envGetter: envWith({}),
  };
  const sync = resolvePrompt(input);
  const async_ = await resolvePromptAsync(input);
  assertEquals(async_.source, sync.source);
  assertEquals(async_.systemInstruction, sync.systemInstruction);
  assertEquals(async_.version, sync.version);
});

Deno.test("resolvePromptAsync: modular but no supabase → identical to sync", async () => {
  const input = {
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  };
  const sync = resolvePrompt(input);
  const async_ = await resolvePromptAsync(input);
  assertEquals(async_.version, sync.version);
});

Deno.test("resolvePromptAsync: modular + supabase but no userId → baseline", async () => {
  const sync = resolvePrompt({
    intent: "chat",
    userId: "u_baseline",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  const async_ = await resolvePromptAsync({
    intent: "chat",
    userId: "",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
    supabase: makeSb({ row: null }),
    routerFlagOverride: true,
  });
  assertEquals(async_.version, sync.version);
});

Deno.test("resolvePromptAsync: router flag off → baseline (no router lookup)", async () => {
  const sync = resolvePrompt({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  // Even with an addendum-bearing supabase + userId, flag off means
  // the router is never consulted.
  const async_ = await resolvePromptAsync({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
    supabase: makeSb({
      row: {
        id: "addendum-X",
        addendum_text: "TREATMENT TEXT",
        status: "approved",
        rollout_pct: 100,
      },
    }),
    routerFlagOverride: false,
  });
  assertEquals(async_.version, sync.version);
  assertEquals(async_.systemInstruction.includes("TREATMENT TEXT"), false);
});

Deno.test("resolvePromptAsync: router flag on but no addendum → baseline", async () => {
  const sync = resolvePrompt({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  const async_ = await resolvePromptAsync({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
    supabase: makeSb({ row: null }),
    routerFlagOverride: true,
  });
  assertEquals(async_.version, sync.version);
});

Deno.test("resolvePromptAsync: router on + approved addendum → version tagged + rules extended", async () => {
  const baseline = resolvePrompt({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  const async_ = await resolvePromptAsync({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
    supabase: makeSb({
      row: {
        id: "addendum-LIVE",
        addendum_text: "Use 'groceries' for food shopping captures.",
        status: "approved",
        rollout_pct: 100,
      },
    }),
    routerFlagOverride: true,
  });
  // Version differs (carries +addendum-... suffix)
  assertEquals(async_.version === baseline.version, false);
  assertEquals(async_.version.includes("+addendum-addendum-LIVE"), true);
  // intent_rules carries the addendum text
  assertEquals(async_.intentRules.includes("Use 'groceries' for food shopping"), true);
  // Source is still 'modular' (router doesn't change source)
  assertEquals(async_.source, "modular");
});

Deno.test("resolvePromptAsync: router lookup throws → baseline (fail-soft)", async () => {
  const baseline = resolvePrompt({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
  });
  const exploder: any = {
    from(_t: string) {
      throw new Error("simulated DB blow-up");
    },
  };
  const async_ = await resolvePromptAsync({
    intent: "chat",
    userId: "u",
    legacyPrompt: "L",
    legacyVersion: "v",
    envGetter: envWith({ USE_INTENT_MODULES: "1" }),
    supabase: exploder,
    routerFlagOverride: true,
  });
  // Fall back to baseline — never throw, never corrupt the request
  assertEquals(async_.version, baseline.version);
  assertEquals(async_.source, "modular");
});
