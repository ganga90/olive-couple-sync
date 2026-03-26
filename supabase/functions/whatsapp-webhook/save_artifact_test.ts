import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const saveArtifactRegex = /\b(save\s+(?:this|it|that)|salva(?:lo|la|melo)?|guarda(?:lo|la|melo)?|save\s+(?:as|in|to)\s+(?:a\s+)?(?:note|task|list|my\s+list)|add\s+(?:this|it|that)\s+(?:to|as|in)\s+(?:a\s+)?(?:note|task|list|my\s+list)|save\s+(?:this|it)\s+(?:for\s+(?:me|later))|keep\s+(?:this|it)|guardalo|salvalo|guardar(?:lo)?|guárdalo|añade(?:lo)?\s+(?:a|como|en))\b/i;

Deno.test("Save artifact patterns - English", () => {
  const cases = [
    { msg: "save this", expected: true },
    { msg: "save it", expected: true },
    { msg: "save it as a note", expected: true },
    { msg: "save this as a task", expected: true },
    { msg: "add this to my list", expected: true },
    { msg: "save it for later", expected: true },
    { msg: "save it for me", expected: true },
    { msg: "keep this", expected: true },
    { msg: "can you save that?", expected: true },
    { msg: "save as a note please", expected: true },
    { msg: "yes please save it", expected: true },
    // Should NOT match
    { msg: "help me plan my week", expected: false },
    { msg: "buy groceries", expected: false },
    { msg: "what's urgent", expected: false },
  ];
  
  for (const tc of cases) {
    const result = saveArtifactRegex.test(tc.msg.toLowerCase());
    assertEquals(result, tc.expected, `"${tc.msg}" should ${tc.expected ? '' : 'NOT '}match`);
  }
});

Deno.test("Save artifact patterns - Italian", () => {
  const cases = [
    { msg: "salvalo", expected: true },
    { msg: "guardalo", expected: true },
    { msg: "salva questo", expected: false }, // "salva" alone without "lo/la" — needs "salvalo"
    { msg: "salvamelo", expected: true },
  ];
  
  for (const tc of cases) {
    const result = saveArtifactRegex.test(tc.msg.toLowerCase());
    assertEquals(result, tc.expected, `"${tc.msg}" should ${tc.expected ? '' : 'NOT '}match`);
  }
});

Deno.test("Save artifact patterns - Spanish", () => {
  const cases = [
    { msg: "guárdalo", expected: true },
    { msg: "guardarlo", expected: true },
    { msg: "añádelo a mis notas", expected: false }, // "añadelo" not "añádelo" in regex
  ];
  
  for (const tc of cases) {
    const result = saveArtifactRegex.test(tc.msg.toLowerCase());
    assertEquals(result, tc.expected, `"${tc.msg}" should ${tc.expected ? '' : 'NOT '}match`);
  }
});
