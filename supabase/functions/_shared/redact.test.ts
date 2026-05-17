import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maskEmail, maskName, maskPhone } from "./redact.ts";

Deno.test("maskPhone — last 4 digits preserved", () => {
  assertEquals(maskPhone("+1 305-555-9123"), "+xxx*9123");
  assertEquals(maskPhone("+34 652 322 025"), "+xxx*2025");
  assertEquals(maskPhone("12025550100"), "+xxx*0100");
});

Deno.test("maskPhone — null/undefined/empty -> (none)", () => {
  assertEquals(maskPhone(null), "(none)");
  assertEquals(maskPhone(undefined), "(none)");
  assertEquals(maskPhone(""), "(none)");
});

Deno.test("maskPhone — too short -> (masked), never leaks near-clear", () => {
  assertEquals(maskPhone("12"), "(masked)");
  assertEquals(maskPhone("abc"), "(masked)");
});

Deno.test("maskEmail — keeps first char + domain", () => {
  assertEquals(maskEmail("ganga90@gmail.com"), "g******@gmail.com");
  assertEquals(maskEmail("a@b.co"), "*@b.co");
  assertEquals(maskEmail("very.long.user@example.org"), "v*************@example.org");
});

Deno.test("maskEmail — null/empty/malformed", () => {
  assertEquals(maskEmail(null), "(none)");
  assertEquals(maskEmail(undefined), "(none)");
  assertEquals(maskEmail(""), "(none)");
  assertEquals(maskEmail("no-at-sign"), "(masked)");
  assertEquals(maskEmail("@nolocal.com"), "(masked)");
});

Deno.test("maskName — first char + stars", () => {
  assertEquals(maskName("Giuseppe Venturi"), "G***************");
  assertEquals(maskName("Anna"), "A***");
  assertEquals(maskName("A"), "A*");
});

Deno.test("maskName — null/empty/whitespace", () => {
  assertEquals(maskName(null), "(none)");
  assertEquals(maskName(undefined), "(none)");
  assertEquals(maskName(""), "(none)");
  assertEquals(maskName("   "), "(none)");
});
