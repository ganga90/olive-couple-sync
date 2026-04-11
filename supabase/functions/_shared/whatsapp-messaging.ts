/**
 * WhatsApp Messaging — Shared Helpers
 * =====================================
 * Reusable WhatsApp messaging utilities for Meta Cloud API interaction,
 * media handling, date formatting, and phone number standardization.
 *
 * Extracted from whatsapp-webhook to enable reuse across:
 *   - WhatsApp webhook (message sending)
 *   - WhatsApp gateway (outbound messaging)
 *   - send-reminders (WhatsApp delivery)
 *
 * Usage:
 *   import { sendWhatsAppReply, formatFriendlyDate } from "../_shared/whatsapp-messaging.ts";
 */

// ─── Phone Number Standardization ──────────────────────────────

/**
 * Standardize phone number format.
 * Meta sends raw numbers like "15551234567" — we ensure "+" prefix.
 */
export function standardizePhoneNumber(rawNumber: string): string {
  let cleaned = rawNumber.replace(/\D/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
}

// ─── Friendly Date Formatting ──────────────────────────────────

/**
 * Format a date/time string into a friendly readable format.
 * e.g. "Friday, February 20th at 12:00 PM"
 *
 * When timezone is provided, the UTC date is converted to the user's local time
 * for display. This is critical because reminder_time is stored in UTC but the
 * user expects to see their local time.
 */
export function formatFriendlyDate(
  dateStr: string,
  includeTime: boolean = true,
  timezone?: string
): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  let dayOfWeek: number, month: number, dayNum: number, year: number, hours: number, mins: number;

  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", hour12: false,
      }).formatToParts(d);

      const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
      month = parseInt(get("month")) - 1;
      dayNum = parseInt(get("day"));
      year = parseInt(get("year"));
      hours = parseInt(get("hour"));
      mins = parseInt(get("minute"));

      const dowStr = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(d);
      const dowMap: Record<string, number> = {
        Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
      };
      dayOfWeek = dowMap[dowStr] ?? d.getUTCDay();
    } catch {
      dayOfWeek = d.getUTCDay(); month = d.getUTCMonth(); dayNum = d.getUTCDate();
      year = d.getUTCFullYear(); hours = d.getUTCHours(); mins = d.getUTCMinutes();
    }
  } else {
    dayOfWeek = d.getUTCDay(); month = d.getUTCMonth(); dayNum = d.getUTCDate();
    year = d.getUTCFullYear(); hours = d.getUTCHours(); mins = d.getUTCMinutes();
  }

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const dayName = days[dayOfWeek];
  const monthName = months[month];

  const suffix =
    dayNum === 1 || dayNum === 21 || dayNum === 31 ? "st"
    : dayNum === 2 || dayNum === 22 ? "nd"
    : dayNum === 3 || dayNum === 23 ? "rd"
    : "th";

  let result = `${dayName}, ${monthName} ${dayNum}${suffix}`;

  const now = new Date();
  if (year !== now.getUTCFullYear()) {
    result += ` ${year}`;
  }

  if (includeTime) {
    if (hours !== 0 || mins !== 0) {
      const h12 = hours % 12 || 12;
      const ampm = hours < 12 ? "AM" : "PM";
      const minStr = mins.toString().padStart(2, "0");
      result += ` at ${h12}:${minStr} ${ampm}`;
    }
  }

  return result;
}

// ─── Meta WhatsApp Cloud API — Send Messages ──────────────────

export async function sendWhatsAppReply(
  phoneNumberId: string,
  to: string,
  text: string,
  accessToken: string,
  mediaUrl?: string
): Promise<boolean> {
  try {
    const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    let body: any;

    if (mediaUrl) {
      body = {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: mediaUrl, caption: text },
      };
    } else {
      body = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: true, body: text },
      };
    }

    console.log("[Meta API] Sending message to:", to, "length:", text.length);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Meta API] Send failed:", response.status, errorText);
      return false;
    }

    const result = await response.json();
    console.log("[Meta API] Message sent successfully, id:", result.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error("[Meta API] Error sending message:", error);
    return false;
  }
}

// ─── Meta Media Download & Upload ──────────────────────────────

export async function downloadAndUploadMetaMedia(
  mediaId: string,
  accessToken: string,
  supabase: any
): Promise<{ url: string; mimeType: string } | null> {
  try {
    // Step 1: Get the media URL from Meta
    const mediaInfoResponse = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaInfoResponse.ok) {
      console.error("[Meta Media] Failed to get media info:", mediaInfoResponse.status);
      const errText = await mediaInfoResponse.text();
      console.error("[Meta Media] Error:", errText);
      return null;
    }

    const mediaInfo = await mediaInfoResponse.json();
    const mediaDownloadUrl = mediaInfo.url;
    const mimeType = mediaInfo.mime_type || "application/octet-stream";

    console.log("[Meta Media] Downloading from:", mediaDownloadUrl, "type:", mimeType);

    // Step 2: Download the actual media file (with 30s timeout)
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(() => downloadController.abort(), 30000);

    let mediaResponse: Response;
    try {
      mediaResponse = await fetch(mediaDownloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: downloadController.signal,
      });
    } catch (fetchErr) {
      clearTimeout(downloadTimeout);
      console.error("[Meta Media] Download timed out or failed:", fetchErr);
      return null;
    }
    clearTimeout(downloadTimeout);

    if (!mediaResponse.ok) {
      console.error("[Meta Media] Failed to download media:", mediaResponse.status);
      return null;
    }

    const mediaBlob = await mediaResponse.blob();
    const arrayBuffer = await mediaBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Step 3: Upload to Supabase Storage
    const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
    const timestamp = new Date().getTime();
    const randomStr = Math.random().toString(36).substring(7);
    const filename = `${timestamp}_${randomStr}.${ext}`;

    const { data, error } = await supabase.storage
      .from("whatsapp-media")
      .upload(filename, uint8Array, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error("[Meta Media] Failed to upload to Supabase:", error);
      return null;
    }

    // Get signed URL (1 year expiry)
    const { data: signedData, error: signedError } = await supabase.storage
      .from("whatsapp-media")
      .createSignedUrl(filename, 60 * 60 * 24 * 365);

    if (signedError || !signedData?.signedUrl) {
      console.error("[Meta Media] Failed to create signed URL:", signedError);
      return null;
    }

    console.log("[Meta Media] Successfully uploaded with signed URL");
    return { url: signedData.signedUrl, mimeType };
  } catch (error) {
    console.error("[Meta Media] Error:", error);
    return null;
  }
}
