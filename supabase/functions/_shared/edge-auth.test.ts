import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveCallerUserId } from "./edge-auth.ts";

/**
 * Build a fake JWT — header.payload.signature, where each segment is
 * base64url-encoded JSON. We don't verify signatures, so the signature
 * segment is just a placeholder. Mirrors how Supabase ships JWTs.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

Deno.test("Clerk JWT (sub present) → returns sub, body user_id ignored", () => {
  const token = makeJwt({ sub: "user_clerk_abc123", iss: "clerk" });
  const result = resolveCallerUserId(token, "different_user_id");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.userId, "user_clerk_abc123");
    assertEquals(result.isServiceRole, false);
  }
});

Deno.test("Clerk JWT + no body user_id still works", () => {
  const token = makeJwt({ sub: "user_clerk_abc123" });
  const result = resolveCallerUserId(token, undefined);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.userId, "user_clerk_abc123");
    assertEquals(result.isServiceRole, false);
  }
});

Deno.test("Service-role JWT + body user_id → returns body user_id", () => {
  const token = makeJwt({ role: "service_role", iss: "supabase" });
  const result = resolveCallerUserId(token, "user_clerk_xyz");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.userId, "user_clerk_xyz");
    assertEquals(result.isServiceRole, true);
  }
});

Deno.test("Service-role JWT + missing user_id → 400", () => {
  const token = makeJwt({ role: "service_role" });
  const result = resolveCallerUserId(token, undefined);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 400);
    assertStringIncludes(result.error, "user_id");
  }
});

Deno.test("Service-role JWT + empty-string user_id → 400", () => {
  const token = makeJwt({ role: "service_role" });
  const result = resolveCallerUserId(token, "");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 400);
});

Deno.test("Service-role JWT + non-string user_id → 400", () => {
  const token = makeJwt({ role: "service_role" });
  const result = resolveCallerUserId(token, 12345);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 400);
});

Deno.test("Service-role beats sub when both are present (no impersonation via embedded sub)", () => {
  const token = makeJwt({ role: "service_role", sub: "would-be-impersonated" });
  // Without body user_id → 400 (service-role path requires explicit id)
  const without = resolveCallerUserId(token, undefined);
  assertEquals(without.ok, false);
  // With body user_id → uses body, NOT the embedded sub
  const withId = resolveCallerUserId(token, "explicit-target");
  assertEquals(withId.ok, true);
  if (withId.ok) {
    assertEquals(withId.userId, "explicit-target");
    assertEquals(withId.isServiceRole, true);
  }
});

Deno.test("JWT with neither sub nor service_role → 401", () => {
  const token = makeJwt({ iss: "stranger", aud: "noone" });
  const result = resolveCallerUserId(token, "anything");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("JWT with empty-string sub and no role → 401", () => {
  const token = makeJwt({ sub: "" });
  const result = resolveCallerUserId(token, undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("Anon JWT (role=anon, no sub) → 401", () => {
  // Supabase anon JWTs have role=anon — should NOT be allowed through
  // either path. The service-role check is strictly equality on
  // "service_role".
  const token = makeJwt({ role: "anon" });
  const result = resolveCallerUserId(token, "user_x");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("Malformed JWT — no dots → 401 Invalid token", () => {
  const result = resolveCallerUserId("not-a-jwt", undefined);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 401);
    assertEquals(result.error, "Invalid token");
  }
});

Deno.test("Malformed JWT — bad base64 in payload → 401", () => {
  const result = resolveCallerUserId("aaa.@@@bad@@@.ccc", undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("Malformed JWT — payload not JSON → 401", () => {
  const badPayload = btoa("not json at all");
  const result = resolveCallerUserId(`aaa.${badPayload}.ccc`, undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("Empty token → 401 Missing token", () => {
  const result = resolveCallerUserId("", undefined);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 401);
    assertEquals(result.error, "Missing token");
  }
});

Deno.test("Non-string token → 401 Missing token", () => {
  // deno-lint-ignore no-explicit-any
  const result = resolveCallerUserId(null as any, undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 401);
});

Deno.test("Deterministic: same input twice yields identical result", () => {
  const token = makeJwt({ sub: "user_x" });
  const r1 = resolveCallerUserId(token, "ignored");
  const r2 = resolveCallerUserId(token, "ignored");
  assertEquals(r1, r2);
});

Deno.test("isServiceRole flag accurately distinguishes the two paths", () => {
  const clerkToken = makeJwt({ sub: "user_clerk" });
  const srToken = makeJwt({ role: "service_role" });

  const clerk = resolveCallerUserId(clerkToken, undefined);
  const sr = resolveCallerUserId(srToken, "target_user");

  if (clerk.ok) assertEquals(clerk.isServiceRole, false);
  if (sr.ok) assertEquals(sr.isServiceRole, true);
});
