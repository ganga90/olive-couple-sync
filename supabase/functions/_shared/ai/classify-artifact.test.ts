// Tests for the pure SAVE_ARTIFACT classifier.
// Two surfaces under test:
//   * `deriveDeterministicTitle` — fully pure, no IO. Tested directly.
//   * `classifyArtifact` — AI-driven with deterministic fallback. Mock
//     `callAI` via the input prop and verify every fallback path.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  classifyArtifact,
  deriveDeterministicTitle,
} from "./classify-artifact.ts";

const EMAIL_DRAFT_CONTENT = `Subject: Dinner soon?

Body:
Hey!

I was thinking it would be great to grab dinner sometime soon. I've been wanting to try a few places like Awash, Palma, or ViceVersa. Do any of those sound good to you, or do you have another spot in mind?

Let me know what you think!

Best,
Almu`;

const RESTAURANT_RECAP = `Benito Juárez Miami is a Tex-Mex/Mexican restaurant located at 295 NW 27th St, Miami, FL 33127. It's known for its delicious food and refreshing margaritas! 🍹

Given your interest in wines and discovering new things, you might enjoy trying out their menu.

Want me to save this?`;

// ─── deriveDeterministicTitle ─────────────────────────────────────────

Deno.test("deriveDeterministicTitle: substantive request becomes title", () => {
  const title = deriveDeterministicTitle(
    EMAIL_DRAFT_CONTENT,
    "What email draft could I write based on the restaurants I like?",
  );
  // No leading "can you/please/what is" → request used verbatim,
  // capitalized, truncated to 60 chars.
  assert(title.startsWith("What email draft"));
  assert(title.length <= 60);
});

Deno.test("deriveDeterministicTitle: strips conversational lead-ins", () => {
  const title = deriveDeterministicTitle(
    "...",
    "Can you help me plan our weekend trip?",
  );
  // "Can you " stripped, first char re-capitalized.
  assertEquals(title.startsWith("Help me plan"), true);
});

Deno.test("deriveDeterministicTitle: confirmation phrase request → falls through to content", () => {
  // Use a fixture whose first substantive line is in the 6-80 char window
  // (the finder skips lines outside that range, which is correct for
  // long paragraph-style content like a Perplexity recap).
  const content = "Benito Juarez Miami\n\nTex-Mex restaurant on NW 27th St.\nKnown for margaritas.";
  const title = deriveDeterministicTitle(content, "yes please");
  // Request is a confirmation → ignored. First substantive content line wins.
  // Must NOT be the confirmation phrase.
  assert(!title.toLowerCase().includes("yes please"));
  // Must be the entity name from the content.
  assertEquals(title, "Benito Juarez Miami");
});

Deno.test("deriveDeterministicTitle: empty request + content with markdown → strips markers", () => {
  const title = deriveDeterministicTitle(
    "## My Header\n\nSome body content here that's quite a bit longer.",
    "",
  );
  // First line after stripping ## is "My Header".
  assertEquals(title, "My Header");
});

Deno.test("deriveDeterministicTitle: nothing useful → safe sentinel", () => {
  const title = deriveDeterministicTitle("", "");
  assertEquals(title, "Saved from Olive chat");
});

Deno.test("deriveDeterministicTitle: very short request → falls through to content", () => {
  // Request shorter than 6 chars → ignored, content-line path runs.
  const title = deriveDeterministicTitle("Apple Watch Ultra 2 details here", "ok");
  assert(title.includes("Apple Watch"));
});

// ─── classifyArtifact ─────────────────────────────────────────────────

Deno.test("classifyArtifact: happy path — AI returns valid JSON", async () => {
  const callAI = async () => JSON.stringify({
    title: "Email Draft About Dinner Plans",
    category: "personal",
    tags: ["dinner", "draft"],
  });

  const result = await classifyArtifact({
    artifactContent: EMAIL_DRAFT_CONTENT,
    artifactRequest: "What email draft could I write?",
    callAI,
    promptVersion: "test-v1",
  });

  assertEquals(result.title, "Email Draft About Dinner Plans");
  assertEquals(result.category, "personal");
  // Tags always end with 'olive-draft' so the web app can query saved drafts.
  assertEquals(result.tags.at(-1), "olive-draft");
  assert(result.tags.includes("dinner"));
});

Deno.test("classifyArtifact: AI returns markdown-wrapped JSON — still parses", async () => {
  const callAI = async () => "```json\n" + JSON.stringify({
    title: "Wines Worth Remembering",
    category: "general",
    tags: ["wine"],
  }) + "\n```";

  const result = await classifyArtifact({
    artifactContent: "Caymus Cab '21 was great",
    artifactRequest: "save this",
    callAI,
    promptVersion: "test-v1",
  });

  assertEquals(result.title, "Wines Worth Remembering");
  assertEquals(result.category, "general");
});

Deno.test("classifyArtifact: AI throws → deterministic fallback used", async () => {
  const callAI = async () => {
    throw new Error("Gemini timeout");
  };

  const result = await classifyArtifact({
    artifactContent: EMAIL_DRAFT_CONTENT,
    artifactRequest: "What email draft could I write?",
    callAI,
    promptVersion: "test-v1",
  });

  // No throw — handler stays alive. Title derived deterministically
  // from the substantive request.
  assert(result.title.toLowerCase().startsWith("what email draft"));
  assertEquals(result.category, "task"); // default
  assertEquals(result.tags, ["olive-draft"]);
});

Deno.test("classifyArtifact: AI returns garbage (non-JSON) → fallback used", async () => {
  const callAI = async () => "I'm sorry, I can't help with that request.";

  const result = await classifyArtifact({
    artifactContent: "## Best Cities to Visit in Italy\n\nFlorence is...",
    artifactRequest: "yes please",
    callAI,
    promptVersion: "test-v1",
  });

  // JSON.parse fails → catch path pulls first content line.
  assertEquals(result.title, "Best Cities to Visit in Italy");
});

Deno.test("classifyArtifact: AI returns 'bad' title — rejected, fallback runs", async () => {
  const callAI = async () => JSON.stringify({
    title: "yes please",   // confirmation phrase — rejected by isBadTitle
    category: "general",
    tags: ["x"],
  });

  const result = await classifyArtifact({
    artifactContent: RESTAURANT_RECAP,
    artifactRequest: "tell me about the restaurant",
    callAI,
    promptVersion: "test-v1",
  });

  // Bad title rejected → deterministic fallback takes over.
  assert(!result.title.toLowerCase().includes("yes please"));
  // Category from AI still respected.
  assertEquals(result.category, "general");
});

Deno.test("classifyArtifact: no callAI injected → pure deterministic path", async () => {
  const result = await classifyArtifact({
    artifactContent: "Some Saved Content Here",
    artifactRequest: "remember this",
    promptVersion: "test-v1",
  });

  // No AI run at all. Should still produce a valid title.
  assert(result.title.length > 0);
  assertEquals(result.category, "task");
  assertEquals(result.tags, ["olive-draft"]);
});

Deno.test("classifyArtifact: AI returns non-string tags — defended", async () => {
  const callAI = async () => JSON.stringify({
    title: "Trip to Florence",
    category: "travel",
    tags: ["valid", 42, null, "another"],  // mixed types
  });

  const result = await classifyArtifact({
    artifactContent: "...",
    artifactRequest: "...",
    callAI,
    promptVersion: "test-v1",
  });

  // Non-strings filtered out; 'olive-draft' suffix preserved.
  assert(result.tags.includes("valid"));
  assert(result.tags.includes("another"));
  assert(!result.tags.includes(42 as unknown as string));
  assertEquals(result.tags.at(-1), "olive-draft");
});

Deno.test("classifyArtifact: empty content + empty request → safe sentinel title", async () => {
  // Even with both fallback paths returning nothing useful, we never
  // return an empty title (clerk_notes.summary is NOT NULL).
  const result = await classifyArtifact({
    artifactContent: "",
    artifactRequest: "",
    promptVersion: "test-v1",
  });

  assertEquals(result.title, "Saved from Olive chat");
});

Deno.test("classifyArtifact: passes correct prompt version + tier to callAI", async () => {
  let capturedTier: string | undefined;
  let capturedVersion: string | undefined;
  const callAI = async (_s: string, _u: string, _temp: number, tier: string, _tracker: unknown, version: string) => {
    capturedTier = tier;
    capturedVersion = version;
    return JSON.stringify({ title: "X", category: "task", tags: [] });
  };

  await classifyArtifact({
    artifactContent: "x",
    artifactRequest: "y",
    callAI,
    promptVersion: "wa-classification-v1.0",
  });

  // Classifier is a cheap lookup — `lite` tier, not standard or pro.
  assertEquals(capturedTier, "lite");
  // Version is passed through verbatim for analytics attribution.
  assertEquals(capturedVersion, "wa-classification-v1.0");
});
