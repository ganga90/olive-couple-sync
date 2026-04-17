/**
 * Unit tests for model-router confidence floors (Phase 1 Task 1-E).
 * Run with: deno test supabase/functions/_shared/model-router.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  checkConfidenceFloor,
  INTENT_CONFIDENCE_FLOORS,
  routeIntent,
} from "./model-router.ts";

// ─── checkConfidenceFloor — destructive intents ────────────────────

Deno.test("checkConfidenceFloor: delete below 0.95 fails", () => {
  const result = checkConfidenceFloor("delete", 0.94);
  assertEquals(result.passes, false);
  assertEquals(result.floor, 0.95);
  assert(result.reason.includes("below_floor"));
});

Deno.test("checkConfidenceFloor: delete at 0.95 passes", () => {
  const result = checkConfidenceFloor("delete", 0.95);
  assertEquals(result.passes, true);
  assert(result.reason.includes("meets_floor"));
});

Deno.test("checkConfidenceFloor: complete respects 0.92 floor", () => {
  assertEquals(checkConfidenceFloor("complete", 0.91).passes, false);
  assertEquals(checkConfidenceFloor("complete", 0.92).passes, true);
  assertEquals(checkConfidenceFloor("complete", 0.99).passes, true);
});

Deno.test("checkConfidenceFloor: set_due respects 0.90 floor", () => {
  assertEquals(checkConfidenceFloor("set_due", 0.89).passes, false);
  assertEquals(checkConfidenceFloor("set_due", 0.90).passes, true);
});

Deno.test("checkConfidenceFloor: assign respects 0.90 floor", () => {
  assertEquals(checkConfidenceFloor("assign", 0.85).passes, false);
  assertEquals(checkConfidenceFloor("assign", 0.91).passes, true);
});

Deno.test("checkConfidenceFloor: move respects 0.90 floor", () => {
  assertEquals(checkConfidenceFloor("move", 0.89).passes, false);
  assertEquals(checkConfidenceFloor("move", 0.90).passes, true);
});

Deno.test("checkConfidenceFloor: set_priority respects lower 0.85 floor", () => {
  assertEquals(checkConfidenceFloor("set_priority", 0.84).passes, false);
  assertEquals(checkConfidenceFloor("set_priority", 0.85).passes, true);
});

// ─── checkConfidenceFloor — ungated intents ────────────────────────

Deno.test("checkConfidenceFloor: non-gated intents always pass", () => {
  // chat/search/contextual_ask/create are NOT in the floor map → pass at any confidence.
  assertEquals(checkConfidenceFloor("chat", 0.1).passes, true);
  assertEquals(checkConfidenceFloor("search", 0.2).passes, true);
  assertEquals(checkConfidenceFloor("create", 0.3).passes, true);
  assertEquals(checkConfidenceFloor("contextual_ask", 0.0).passes, true);
});

Deno.test("checkConfidenceFloor: unknown intent passes (no_floor)", () => {
  const r = checkConfidenceFloor("mystery_intent", 0.0);
  assertEquals(r.passes, true);
  assert(r.reason.startsWith("no_floor:"));
});

// ─── Floor map integrity ───────────────────────────────────────────

Deno.test("INTENT_CONFIDENCE_FLOORS: delete has strictest floor", () => {
  // Destructive intents should have the highest floors.
  const deleteFloor = INTENT_CONFIDENCE_FLOORS["delete"];
  const allFloors = Object.values(INTENT_CONFIDENCE_FLOORS);
  assertEquals(deleteFloor, Math.max(...allFloors));
});

Deno.test("INTENT_CONFIDENCE_FLOORS: all floors in [0, 1]", () => {
  for (const [intent, floor] of Object.entries(INTENT_CONFIDENCE_FLOORS)) {
    assert(floor > 0 && floor <= 1, `${intent} floor ${floor} must be in (0, 1]`);
  }
});

// ─── routeIntent sanity ────────────────────────────────────────────

Deno.test("routeIntent: delete is DB-only → lite tier", () => {
  const r = routeIntent("delete");
  assertEquals(r.responseTier, "lite");
  assertEquals(r.reason, "db_operation");
});

Deno.test("routeIntent: chat defaults to standard", () => {
  const r = routeIntent("chat");
  assertEquals(r.responseTier, "standard");
});

Deno.test("routeIntent: weekly_summary chat escalates to pro", () => {
  const r = routeIntent("chat", "weekly_summary");
  assertEquals(r.responseTier, "pro");
});

Deno.test("routeIntent: expense + media escalates to pro (receipt extraction)", () => {
  const r = routeIntent("expense", undefined, true);
  assertEquals(r.responseTier, "pro");
  assert(r.reason.startsWith("media_pro:"));
});
