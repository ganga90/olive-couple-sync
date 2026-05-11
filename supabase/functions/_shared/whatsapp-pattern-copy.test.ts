// Tests for _shared/whatsapp-pattern-copy.ts
// Pin the en/es/it strings used in WhatsApp offer suffixes.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWhatsAppPatternSuffix } from "./whatsapp-pattern-copy.ts";
import type { MatchedPattern } from "./pattern-detector.ts";

function shift(from: number, to: number): MatchedPattern {
  return {
    pattern_type: "weekday_shift",
    pattern_data: { from_dow: from, to_dow: to },
    count: 5,
    confidence: 0.7,
    last_seen_at: new Date().toISOString(),
  };
}

Deno.test("buildWhatsAppPatternSuffix: undefined → empty", () => {
  assertEquals(buildWhatsAppPatternSuffix(undefined, "en"), "");
});

Deno.test("buildWhatsAppPatternSuffix: empty array → empty", () => {
  assertEquals(buildWhatsAppPatternSuffix([], "en"), "");
});

Deno.test("buildWhatsAppPatternSuffix: Tue→Thu (en)", () => {
  const out = buildWhatsAppPatternSuffix([shift(2, 4)], "en");
  assert(out.includes("💡"));
  assert(out.toLowerCase().includes("tuesday"));
  assert(out.toLowerCase().includes("thursday"));
});

Deno.test("buildWhatsAppPatternSuffix: Tue→Thu (es)", () => {
  const out = buildWhatsAppPatternSuffix([shift(2, 4)], "es");
  assert(out.includes("martes"));
  assert(out.includes("jueves"));
});

Deno.test("buildWhatsAppPatternSuffix: Tue→Thu (it)", () => {
  const out = buildWhatsAppPatternSuffix([shift(2, 4)], "it");
  assert(out.includes("martedì"));
  assert(out.includes("giovedì"));
});

Deno.test("buildWhatsAppPatternSuffix: BCP-47 'es-ES' normalizes", () => {
  const out = buildWhatsAppPatternSuffix([shift(2, 4)], "es-ES");
  assert(out.includes("martes"));
});

Deno.test("buildWhatsAppPatternSuffix: unknown lang falls back to en", () => {
  const out = buildWhatsAppPatternSuffix([shift(2, 4)], "fr");
  assert(out.toLowerCase().includes("tuesday"));
});

Deno.test("buildWhatsAppPatternSuffix: out-of-range day → empty (fail safe)", () => {
  assertEquals(buildWhatsAppPatternSuffix([shift(2, 9)], "en"), "");
});

Deno.test("buildWhatsAppPatternSuffix: non-weekday_shift type → empty", () => {
  const future: MatchedPattern = {
    pattern_type: "weekday_shift" as never, // simulate future variant
    pattern_data: { foo: "bar" },
    count: 5,
    confidence: 0.7,
    last_seen_at: new Date().toISOString(),
  };
  // pattern_type IS weekday_shift but pattern_data lacks the dows.
  // Fail-safe path → empty.
  assertEquals(buildWhatsAppPatternSuffix([future], "en"), "");
});
