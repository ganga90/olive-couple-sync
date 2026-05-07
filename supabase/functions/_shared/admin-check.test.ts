import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { requireAdmin } from "./admin-check.ts";

/**
 * Build a fake supabase client whose `.rpc()` returns a fixed
 * `{ data, error }` shape. Used to drive the admin-check helper through
 * each branch of the has_role outcome matrix.
 */
function fakeSupabase(rpcResult: { data?: unknown; error?: unknown } | Error) {
  return {
    rpc(_name: string, _params: Record<string, unknown>) {
      if (rpcResult instanceof Error) {
        return Promise.reject(rpcResult);
      }
      return Promise.resolve(rpcResult);
    },
  };
}

Deno.test("Service-role bypass: returns ok without calling rpc", async () => {
  let rpcCalled = false;
  const sb = {
    rpc(_name: string, _params: Record<string, unknown>) {
      rpcCalled = true;
      return Promise.resolve({ data: false });
    },
  };
  const result = await requireAdmin(sb, "user_anything", true);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.isServiceRole, true);
  assertEquals(rpcCalled, false);
});

Deno.test("Admin user (rpc returns true) → ok with isServiceRole=false", async () => {
  const sb = fakeSupabase({ data: true });
  const result = await requireAdmin(sb, "user_admin_123", false);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.isServiceRole, false);
});

Deno.test("Non-admin user (rpc returns false) → blocked with reason=not_admin", async () => {
  const sb = fakeSupabase({ data: false });
  const result = await requireAdmin(sb, "user_regular", false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "not_admin");
});

Deno.test("RPC returns null → blocked (defensive: only true grants access)", async () => {
  const sb = fakeSupabase({ data: null });
  const result = await requireAdmin(sb, "user_x", false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "not_admin");
});

Deno.test("RPC error response → blocked with reason=lookup_failed (fails closed)", async () => {
  const sb = fakeSupabase({ error: { message: "function has_role does not exist" } });
  const result = await requireAdmin(sb, "user_x", false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "lookup_failed");
});

Deno.test("RPC throws → blocked with reason=lookup_failed (fails closed)", async () => {
  const sb = fakeSupabase(new Error("network unreachable"));
  const result = await requireAdmin(sb, "user_x", false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "lookup_failed");
});

Deno.test("Empty userId + non-service-role → missing_user_id", async () => {
  const sb = fakeSupabase({ data: true });
  const result = await requireAdmin(sb, "", false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "missing_user_id");
});

Deno.test("Non-string userId + non-service-role → missing_user_id", async () => {
  const sb = fakeSupabase({ data: true });
  // deno-lint-ignore no-explicit-any
  const result = await requireAdmin(sb, null as any, false);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "missing_user_id");
});

Deno.test("Service-role + empty userId still bypasses (service-role wins)", async () => {
  // A service-role caller without a userId is still a service-role
  // caller. The caller's bearer token authenticates them; userId is for
  // audit-trail purposes downstream. requireAdmin's job is only to
  // gate access.
  const sb = fakeSupabase({ data: false });
  const result = await requireAdmin(sb, "", true);
  assertEquals(result.ok, true);
});

Deno.test("RPC called with correct (p_user_id, p_role=admin) params", async () => {
  let calledName: string | null = null;
  let calledParams: Record<string, unknown> | null = null;
  const sb = {
    rpc(name: string, params: Record<string, unknown>) {
      calledName = name;
      calledParams = params;
      return Promise.resolve({ data: true });
    },
  };
  await requireAdmin(sb, "user_target", false);
  assertEquals(calledName, "has_role");
  assertEquals(calledParams, { p_user_id: "user_target", p_role: "admin" });
});

Deno.test("Deterministic: same call twice yields identical result", async () => {
  const sb = fakeSupabase({ data: true });
  const r1 = await requireAdmin(sb, "user_x", false);
  const r2 = await requireAdmin(sb, "user_x", false);
  assertEquals(r1, r2);
});
