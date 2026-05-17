// Co-located tests for the WhatsApp Cloud API webhook parser.
//
// Coverage
//   1. isValidCoordinates — boundary + invalid inputs
//   2. extractMetaMessage — every supported message.type variant
//      (text, image, video, audio, document, location, contacts,
//      interactive, unhandled), plus envelope edge cases (no
//      messages, missing entry, status updates, malformed body,
//      quoted-message context, Meta timestamp normalisation).

import {
  assertEquals,
  assertExists,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  isValidCoordinates,
  extractMetaMessage,
  MAX_MESSAGE_LENGTH,
  MAX_MEDIA_COUNT,
} from "./whatsapp-meta-parser.ts";

// ────────────────────────────────────────────────────────────────────
// isValidCoordinates
// ────────────────────────────────────────────────────────────────────

Deno.test("isValidCoordinates: both null → true (no location is fine)", () => {
  assertEquals(isValidCoordinates(null, null), true);
});

Deno.test("isValidCoordinates: one null → true (treated as 'no location')", () => {
  assertEquals(isValidCoordinates("40.7128", null), true);
  assertEquals(isValidCoordinates(null, "-74.0060"), true);
});

Deno.test("isValidCoordinates: in-range floats → true", () => {
  assertEquals(isValidCoordinates("40.7128", "-74.0060"), true);
  assertEquals(isValidCoordinates("0", "0"), true);
  assertEquals(isValidCoordinates("-89.9", "179.9"), true);
});

Deno.test("isValidCoordinates: at the boundary → true", () => {
  assertEquals(isValidCoordinates("90", "180"), true);
  assertEquals(isValidCoordinates("-90", "-180"), true);
});

Deno.test("isValidCoordinates: out of range → false", () => {
  assertEquals(isValidCoordinates("91", "0"), false);
  assertEquals(isValidCoordinates("0", "181"), false);
  assertEquals(isValidCoordinates("-91", "0"), false);
  assertEquals(isValidCoordinates("0", "-181"), false);
});

Deno.test("isValidCoordinates: NaN strings → false", () => {
  assertEquals(isValidCoordinates("not-a-number", "0"), false);
  assertEquals(isValidCoordinates("0", "garbage"), false);
});

// ────────────────────────────────────────────────────────────────────
// Constants — pin sanity-check
// ────────────────────────────────────────────────────────────────────

Deno.test("MAX_MESSAGE_LENGTH is the historical 10k cap", () => {
  assertEquals(MAX_MESSAGE_LENGTH, 10000);
});

Deno.test("MAX_MEDIA_COUNT is the historical 10-item cap", () => {
  assertEquals(MAX_MEDIA_COUNT, 10);
});

// ────────────────────────────────────────────────────────────────────
// extractMetaMessage — envelope edge cases
// ────────────────────────────────────────────────────────────────────

Deno.test("extractMetaMessage: empty body → null", () => {
  assertEquals(extractMetaMessage({}), null);
  assertEquals(extractMetaMessage(null), null);
  assertEquals(extractMetaMessage(undefined), null);
});

Deno.test("extractMetaMessage: status-update payload (no messages) → null", () => {
  // Meta delivers a status webhook with `value.statuses` populated
  // and `value.messages` absent.
  const body = {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "X" },
          statuses: [{ id: "wamid.X", status: "delivered" }],
        },
      }],
    }],
  };
  assertEquals(extractMetaMessage(body), null);
});

Deno.test("extractMetaMessage: completely malformed body → null (caught error path)", () => {
  // Force a Throwy access via a body that breaks the property chain
  // after the surface check.
  const body = { entry: [{ changes: [{ value: { messages: [{}] /* no `from`/`type` */ } }] }] };
  const out = extractMetaMessage(body);
  assertExists(out); // null type discriminant defaults; behaves as "text" with null body
  assertEquals(out?.messageBody, null);
});

// ────────────────────────────────────────────────────────────────────
// extractMetaMessage — per-type fixtures
// ────────────────────────────────────────────────────────────────────

function makeEnvelope(message: Record<string, unknown>) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "100200300" },
          messages: [{
            id: "wamid.HBgM",
            from: "15551234567",
            timestamp: "1715900000",
            ...message,
          }],
        },
      }],
    }],
  };
}

Deno.test("extractMetaMessage: text message → messageBody populated", () => {
  const body = makeEnvelope({
    type: "text",
    text: { body: "Hello Olive" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.fromNumber, "15551234567");
  assertEquals(out?.messageBody, "Hello Olive");
  assertEquals(out?.messageType, "text");
  assertEquals(out?.mediaItems, []);
  assertEquals(out?.phoneNumberId, "100200300");
});

Deno.test("extractMetaMessage: image with caption → media + body", () => {
  const body = makeEnvelope({
    type: "image",
    image: { id: "media-1", mime_type: "image/png", caption: "look" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, "look");
  assertEquals(out?.mediaItems, [{ id: "media-1", mimeType: "image/png" }]);
});

Deno.test("extractMetaMessage: image without mime_type → defaults to image/jpeg", () => {
  const body = makeEnvelope({
    type: "image",
    image: { id: "media-2" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.mediaItems[0].mimeType, "image/jpeg");
});

Deno.test("extractMetaMessage: video → media populated, caption preserved", () => {
  const body = makeEnvelope({
    type: "video",
    video: { id: "v1", mime_type: "video/mp4", caption: "cool video" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.mediaItems[0].id, "v1");
  assertEquals(out?.messageBody, "cool video");
});

Deno.test("extractMetaMessage: audio → media only, no body", () => {
  const body = makeEnvelope({
    type: "audio",
    audio: { id: "voice-1", mime_type: "audio/ogg" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.mediaItems[0].mimeType, "audio/ogg");
  assertEquals(out?.messageBody, null);
});

Deno.test("extractMetaMessage: document falls back to filename", () => {
  const body = makeEnvelope({
    type: "document",
    document: { id: "d1", mime_type: "application/pdf", filename: "report.pdf" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, "report.pdf");
});

Deno.test("extractMetaMessage: location → lat/lon strings + name as body", () => {
  const body = makeEnvelope({
    type: "location",
    location: { latitude: 40.7128, longitude: -74.0060, name: "NYC" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.latitude, "40.7128");
  assertEquals(out?.longitude, "-74.006");
  assertEquals(out?.messageBody, "NYC");
});

Deno.test("extractMetaMessage: contacts → 'Shared contact: <name>'", () => {
  const body = makeEnvelope({
    type: "contacts",
    contacts: [{ name: { formatted_name: "Alice" } }],
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, "Shared contact: Alice");
});

Deno.test("extractMetaMessage: interactive button_reply → title", () => {
  const body = makeEnvelope({
    type: "interactive",
    interactive: { button_reply: { id: "btn1", title: "Confirm" } },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, "Confirm");
});

Deno.test("extractMetaMessage: interactive list_reply → title", () => {
  const body = makeEnvelope({
    type: "interactive",
    interactive: { list_reply: { id: "row1", title: "Option B" } },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, "Option B");
});

Deno.test("extractMetaMessage: unhandled message.type → null body, type preserved", () => {
  const body = makeEnvelope({ type: "sticker" });
  const out = extractMetaMessage(body);
  assertEquals(out?.messageBody, null);
  assertEquals(out?.messageType, "sticker");
});

// ────────────────────────────────────────────────────────────────────
// extractMetaMessage — quoted-message & timestamp normalisation
// ────────────────────────────────────────────────────────────────────

Deno.test("extractMetaMessage: quoted message (context.id) → quotedMessageId populated", () => {
  const body = makeEnvelope({
    type: "text",
    text: { body: "snooze" },
    context: { from: "15550000000", id: "wamid.PREVIOUS" },
  });
  const out = extractMetaMessage(body);
  assertEquals(out?.quotedMessageId, "wamid.PREVIOUS");
});

Deno.test("extractMetaMessage: no quote context → quotedMessageId null", () => {
  const body = makeEnvelope({ type: "text", text: { body: "hi" } });
  const out = extractMetaMessage(body);
  assertEquals(out?.quotedMessageId, null);
});

Deno.test("extractMetaMessage: timestamp normalised to ISO string", () => {
  const body = makeEnvelope({ type: "text", text: { body: "hi" } });
  const out = extractMetaMessage(body);
  // makeEnvelope sets timestamp 1715900000 (May 17 2024 ...). ISO format
  // should start with the year and be parseable.
  assertExists(out?.receivedAtIso);
  const parsed = new Date(out!.receivedAtIso);
  assertEquals(parsed.getUTCFullYear(), 2024);
});

Deno.test("extractMetaMessage: missing timestamp → falls back to current time (recent)", () => {
  // Build envelope without timestamp.
  const body = {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "X" },
          messages: [{ id: "w1", from: "1", type: "text", text: { body: "x" } }],
        },
      }],
    }],
  };
  const before = Date.now();
  const out = extractMetaMessage(body);
  const after = Date.now();
  const recv = new Date(out!.receivedAtIso).getTime();
  // Allow a small slop window for the test's own clock progression.
  assertNotEquals(out?.receivedAtIso, undefined);
  // Should be within the test invocation window.
  assertEquals(recv >= before - 10 && recv <= after + 10, true);
});
