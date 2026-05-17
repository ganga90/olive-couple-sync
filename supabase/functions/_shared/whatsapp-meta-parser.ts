// WhatsApp Cloud API webhook payload parser.
//
// Why this module exists
//   Extracted from supabase/functions/whatsapp-webhook/index.ts
//   (TASK-10X-Phase8d). The monolith embedded a single 100-line
//   parser plus a tiny coordinate-validation helper inline. Pulling
//   them out has two wins:
//     1. The parser is the natural entry point for any future
//        webhook (the in-development group webhook, an Instagram
//        DM webhook, the WhatsApp Business API webhook for B2B).
//        Sharing the parser stops three implementations from drifting.
//     2. The parser is pure (deterministic body → normalized struct),
//        so it can be exhaustively tested without spinning up the
//        full webhook.
//
// What the parser handles
//   Meta's WhatsApp webhook delivers an envelope shaped like
//   `body.entry[0].changes[0].value.messages[0]`. Each message has a
//   `type` discriminator (`text`, `image`, `video`, `audio`,
//   `document`, `location`, `contacts`, `interactive`). This parser
//   normalises every supported type into a flat `MetaMessageData`
//   struct so downstream routing logic doesn't have to know Meta's
//   envelope shape.
//
// Failure mode
//   The parser NEVER throws. Status-update payloads (which have no
//   `messages` array) return null; unhandled types return a struct
//   with `messageBody: null`. Errors are logged to `[Meta]` with the
//   exception and the function returns null so the caller can early-
//   return a 200 and let Meta retry rather than crash.

// Constants for input validation
export const MAX_MESSAGE_LENGTH = 10000;
export const MAX_MEDIA_COUNT = 10;

/**
 * Validate that latitude / longitude fall in plausible ranges.
 *
 * Returns true when both are null/empty (no coordinates were
 * shipped — fine, location is optional). Returns true when both
 * parse as numbers AND satisfy `-90 <= lat <= 90` and
 * `-180 <= lon <= 180`. Returns false otherwise.
 *
 * Defensive against the case where Meta's webhook delivers
 * malformed strings — we don't want the orchestrator to feed
 * garbage into downstream geocoding.
 */
export function isValidCoordinates(lat: string | null, lon: string | null): boolean {
  if (!lat || !lon) return true;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);
  return !isNaN(latitude) && !isNaN(longitude) &&
         latitude >= -90 && latitude <= 90 &&
         longitude >= -180 && longitude <= 180;
}

export interface MetaMessageData {
  fromNumber: string;
  messageBody: string | null;
  mediaItems: Array<{ id: string; mimeType: string }>;
  latitude: string | null;
  longitude: string | null;
  phoneNumberId: string;
  messageId: string;
  /**
   * Raw Meta `message.type` — used by callers to derive
   * `inboundNoteSource` (whatsapp / whatsapp-voice / whatsapp-media)
   * for clerk_notes inserts. Preserved as the raw type string so
   * routing logic above this layer can switch on it; the helper
   * `whatsappSourceFromMessageType` collapses it to a NoteSource.
   */
  messageType: string;
  /**
   * PR4 / Block C — WAMID of the message the user is "replying to" /
   * quoting in WhatsApp's UI. Present only when `message.context.id`
   * is delivered by Meta. Used to disambiguate which task the user
   * means in follow-up corrections (resolves via `resolveQuotedTask`).
   */
  quotedMessageId: string | null;
  /**
   * PR8 / Phase 2 — Meta's own timestamp for the message, normalized
   * to ISO string. Used by the inbound cluster buffer for ordering.
   * Falls back to "now" if Meta didn't deliver one.
   */
  receivedAtIso: string;
}

// deno-lint-ignore no-explicit-any -- Meta webhook body is shaped by Meta, not us
export function extractMetaMessage(body: any): MetaMessageData | null {
  try {
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages || value.messages.length === 0) {
      console.log('[Meta] No messages in webhook (could be status update)');
      return null;
    }

    const message = value.messages[0];
    const phoneNumberId = value.metadata?.phone_number_id;
    const fromNumber = message.from; // Raw number like "15551234567"
    const messageId = message.id;

    // PR4 / Block C — quoted-message awareness.
    //
    // When the user "replies to" / "quotes" one of Olive's previous
    // messages, Meta delivers `message.context.id` containing the
    // WAMID of the quoted message. Olive uses this to disambiguate
    // which memory/task the user is referring to in their follow-up
    // — without it, we fall back to "most recently referenced" which
    // races dangerously when text+image arrive within seconds.
    //
    // We also capture `context.from` for completeness/logging,
    // though the WAMID alone is sufficient for resolution.
    const quotedMessageId: string | null = message.context?.id ?? null;
    if (quotedMessageId) {
      console.log("[Meta] Inbound quotes WAMID:", quotedMessageId);
    }

    // PR8 / Phase 2 — Capture Meta's own timestamp for the message.
    // Meta delivers `message.timestamp` as a Unix-seconds string.
    // The clustering buffer uses this for ordering — trusting Meta's
    // clock prevents per-server drift from mis-ordering events that
    // arrive in concurrent webhooks. Falls back to "now" if missing.
    const metaTimestampSec = message.timestamp ? parseInt(String(message.timestamp), 10) : NaN;
    const receivedAtIso: string = Number.isFinite(metaTimestampSec)
      ? new Date(metaTimestampSec * 1000).toISOString()
      : new Date().toISOString();

    let messageBody: string | null = null;
    let latitude: string | null = null;
    let longitude: string | null = null;
    const mediaItems: Array<{ id: string; mimeType: string }> = [];

    switch (message.type) {
      case 'text':
        messageBody = message.text?.body || null;
        break;
      case 'image':
        if (message.image) {
          mediaItems.push({ id: message.image.id, mimeType: message.image.mime_type || 'image/jpeg' });
          messageBody = message.image.caption || null;
        }
        break;
      case 'video':
        if (message.video) {
          mediaItems.push({ id: message.video.id, mimeType: message.video.mime_type || 'video/mp4' });
          messageBody = message.video.caption || null;
        }
        break;
      case 'audio':
        if (message.audio) {
          mediaItems.push({ id: message.audio.id, mimeType: message.audio.mime_type || 'audio/ogg' });
        }
        break;
      case 'document':
        if (message.document) {
          mediaItems.push({ id: message.document.id, mimeType: message.document.mime_type || 'application/pdf' });
          messageBody = message.document.caption || message.document.filename || null;
        }
        break;
      case 'location':
        latitude = String(message.location?.latitude || '');
        longitude = String(message.location?.longitude || '');
        messageBody = message.location?.name || message.location?.address || null;
        break;
      case 'contacts':
        messageBody = `Shared contact: ${message.contacts?.[0]?.name?.formatted_name || 'Unknown'}`;
        break;
      case 'interactive':
        // Handle button/list replies
        messageBody = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
        break;
      default:
        console.log('[Meta] Unhandled message type:', message.type);
        messageBody = null;
    }

    return {
      fromNumber: fromNumber || '',
      messageBody,
      mediaItems,
      latitude: latitude || null,
      longitude: longitude || null,
      phoneNumberId: phoneNumberId || '',
      messageId: messageId || '',
      messageType: message.type || 'text',
      quotedMessageId,
      receivedAtIso,
    };
  } catch (error) {
    console.error('[Meta] Error extracting message:', error);
    return null;
  }
}
