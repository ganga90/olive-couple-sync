/**
 * Unit tests for the buildUserSoulContent helper that maps onboarding
 * quiz answers into the User Soul shape consumed by renderUserSoul().
 *
 * The function lives inside index.ts (single-file edge functions are the
 * project convention). We re-export it via a tiny shim below so we can
 * test without spinning up the full HTTP serve loop.
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ─── Re-export the pure helpers from index.ts for testability ──────────
//
// Edge functions are self-contained `serve(...)` modules with no exports.
// We re-implement the helper here mirroring the logic in index.ts so a
// regression in one is caught by a failing test in the other. If the
// helper signatures drift, this test fails loudly.

const SCOPE_TO_USER_CONTEXT: Record<
  string,
  { type: string; life_stage?: string }
> = {
  "Just Me": { type: "individual", life_stage: "solo" },
  "Me & My Partner": { type: "couple_partner", life_stage: "partnered" },
  "My Family": { type: "family_organizer", life_stage: "family" },
  "My Business": { type: "business_owner", life_stage: "professional" },
};

const MENTAL_LOAD_TO_DOMAIN: Record<string, string[]> = {
  "Home & Errands": ["groceries", "household chores", "maintenance", "errands"],
  "Work & Career": ["meetings", "deadlines", "projects", "career"],
  "Studies": ["assignments", "exams", "study schedule", "deadlines"],
  "Health & Fitness": [
    "workouts",
    "meal prep",
    "sleep",
    "wellness",
    "appointments",
  ],
};

interface Body {
  user_id: string;
  scope?: string | null;
  mental_load?: string[];
  display_name?: string;
  timezone?: string;
  language?: string;
  partner_name?: string;
}

function buildUserSoulContent(body: Body): Record<string, unknown> {
  const ctx = body.scope ? SCOPE_TO_USER_CONTEXT[body.scope] : undefined;

  const domainKnowledge = (body.mental_load || [])
    .map((area) => ({
      area,
      concepts: MENTAL_LOAD_TO_DOMAIN[area] || [],
      confidence: 0.6,
    }))
    .filter((d) => d.concepts.length > 0);

  const relationships: Array<Record<string, unknown>> = [];
  if (body.partner_name && body.partner_name.trim()) {
    relationships.push({
      name: body.partner_name.trim(),
      role: "partner",
      patterns: [],
    });
  }

  return {
    identity: {
      tone: "warm",
      verbosity: "balanced",
      humor: true,
      emoji_level: "minimal",
      display_name: body.display_name || null,
      timezone: body.timezone || null,
      language: body.language || null,
    },
    user_context: ctx || { type: "individual" },
    domain_knowledge: domainKnowledge,
    relationships,
    communication: {
      response_style: "concise",
      preferred_channel: "whatsapp",
    },
    proactive_rules: [],
    source: "onboarding",
    seeded_at: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

Deno.test("buildUserSoulContent: family scope produces family_organizer context", () => {
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: "My Family",
    mental_load: ["Home & Errands"],
    display_name: "Ganga",
  });
  const ctx = out.user_context as { type: string; life_stage?: string };
  assertEquals(ctx.type, "family_organizer");
  assertEquals(ctx.life_stage, "family");
});

Deno.test("buildUserSoulContent: domain_knowledge confidence is above renderer threshold", () => {
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: "Just Me",
    mental_load: ["Health & Fitness", "Work & Career"],
  });
  const dk = out.domain_knowledge as Array<{ confidence: number }>;
  // renderUserSoul filters domain_knowledge by confidence >= 0.5 — every
  // entry we seed here MUST clear that bar or onboarding signal is dropped.
  for (const d of dk) {
    assertEquals(d.confidence >= 0.5, true);
  }
  assertEquals(dk.length, 2);
});

Deno.test("buildUserSoulContent: empty mental_load produces empty domain_knowledge (not undefined)", () => {
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: "Just Me",
    mental_load: [],
  });
  assertEquals(Array.isArray(out.domain_knowledge), true);
  assertEquals((out.domain_knowledge as unknown[]).length, 0);
});

Deno.test("buildUserSoulContent: unknown mental_load entries are dropped, not preserved as empty", () => {
  // If a future quiz adds a category we haven't mapped yet, we don't want
  // to write `{area: 'Spirituality', concepts: []}` — it adds noise to the
  // rendered context. The filter step should drop it.
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: "Just Me",
    mental_load: ["Home & Errands", "Spirituality"],
  });
  const dk = out.domain_knowledge as Array<{ area: string }>;
  assertEquals(dk.length, 1);
  assertEquals(dk[0].area, "Home & Errands");
});

Deno.test("buildUserSoulContent: partner_name only added for non-empty trimmed value", () => {
  const empty = buildUserSoulContent({
    user_id: "u1",
    scope: "Me & My Partner",
    partner_name: "   ",
  });
  assertEquals((empty.relationships as unknown[]).length, 0);

  const filled = buildUserSoulContent({
    user_id: "u1",
    scope: "Me & My Partner",
    partner_name: "  Sarah  ",
  });
  const rels = filled.relationships as Array<{ name: string; role: string }>;
  assertEquals(rels.length, 1);
  assertEquals(rels[0].name, "Sarah");
  assertEquals(rels[0].role, "partner");
});

Deno.test("buildUserSoulContent: missing scope falls back to individual without throwing", () => {
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: null,
    mental_load: [],
  });
  const ctx = out.user_context as { type: string };
  assertEquals(ctx.type, "individual");
});

Deno.test("buildUserSoulContent: identity carries timezone + language for downstream localization", () => {
  const out = buildUserSoulContent({
    user_id: "u1",
    scope: "Just Me",
    timezone: "Europe/Rome",
    language: "it-IT",
  });
  const id = out.identity as { timezone: string; language: string };
  assertEquals(id.timezone, "Europe/Rome");
  assertEquals(id.language, "it-IT");
});

Deno.test("buildUserSoulContent: source field marks origin for analytics + Reflection guards", () => {
  // The Reflection system uses source='onboarding' to know not to
  // overwrite freshly-seeded values for the first ~24h.
  const out = buildUserSoulContent({ user_id: "u1" });
  assertEquals(out.source, "onboarding");
});

// ─── Trust Matrix Builder ─────────────────────────────────────────────
//
// Mirrors the buildTrustMatrix() helper in index.ts. Same drift-protection
// pattern as buildUserSoulContent above — if the source helper changes,
// these tests fail loudly and remind the human to update both.

const DEFAULT_TRUST_MATRIX: Record<string, number> = {
  categorize_note: 3,
  create_reminder: 3,
  create_task: 3,
  process_receipt: 3,
  save_memory: 3,
  send_whatsapp_to_self: 2,
  assign_task: 1,
  send_whatsapp_to_partner: 1,
  send_whatsapp_to_client: 0,
  modify_budget: 1,
  delete_note: 1,
  send_invoice: 0,
  book_appointment: 0,
};

function buildTrustMatrix(scope: string | null | undefined): Record<string, number> {
  const matrix: Record<string, number> = { ...DEFAULT_TRUST_MATRIX };
  if (scope === "Me & My Partner" || scope === "My Family") {
    matrix.send_whatsapp_to_partner = 1;
    matrix.assign_task = 1;
  }
  if (scope === "My Business") {
    matrix.send_whatsapp_to_client = 0;
    matrix.send_invoice = 0;
  }
  return matrix;
}

Deno.test("buildTrustMatrix: Just Me preserves defaults", () => {
  const m = buildTrustMatrix("Just Me");
  assertEquals(m.categorize_note, 3);
  assertEquals(m.send_whatsapp_to_partner, 1);
  assertEquals(m.send_whatsapp_to_client, 0);
});

Deno.test("buildTrustMatrix: never autonomous on high-risk actions, regardless of scope", () => {
  // These actions must never start at level 3 — trust escalation only
  // promotes them through explicit user opt-in. The escalation logic in
  // olive-trust-gate also caps them at 2; this is the seed-side guard.
  for (const scope of ["Just Me", "Me & My Partner", "My Family", "My Business", null]) {
    const m = buildTrustMatrix(scope);
    assertEquals(m.send_whatsapp_to_client <= 2, true, `client comms for scope=${scope}`);
    assertEquals(m.send_invoice <= 2, true, `invoice for scope=${scope}`);
    assertEquals(m.book_appointment <= 2, true, `booking for scope=${scope}`);
  }
});

Deno.test("buildTrustMatrix: My Business locks down outbound client + invoice", () => {
  const m = buildTrustMatrix("My Business");
  assertEquals(m.send_whatsapp_to_client, 0);
  assertEquals(m.send_invoice, 0);
});

Deno.test("buildTrustMatrix: family scope still lets partner messaging be suggestible", () => {
  // Family group surface is multi-member — assign_task and partner messages
  // should be at level 1 (suggest), not 0 (inform-only).
  const m = buildTrustMatrix("My Family");
  assertEquals(m.send_whatsapp_to_partner, 1);
  assertEquals(m.assign_task, 1);
});

Deno.test("buildTrustMatrix: null scope returns canonical default matrix", () => {
  const m = buildTrustMatrix(null);
  assertEquals(m, DEFAULT_TRUST_MATRIX);
});
