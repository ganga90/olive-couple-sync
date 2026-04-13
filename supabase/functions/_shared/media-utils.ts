/**
 * Shared Media Utilities — "The Eyes"
 * ====================================
 * Centralized media processing for multimodal Gemini payloads.
 * Used by whatsapp-webhook, ask-olive-individual, and process-note.
 *
 * Provides:
 *   - arrayBufferToBase64()     — chunked base64 conversion (no stack overflow)
 *   - getMediaType()            — detect type from URL/MIME
 *   - downloadMediaToBase64()   — fetch → validate size → encode
 *   - buildGeminiMediaParts()   — construct inlineData parts array
 *   - MULTIMODAL_SYSTEM_PROMPT_SUFFIX — vision instruction for LLM
 */

// ─── Size Limits ──────────────────────────────────────────────

/** Maximum file size for base64 inlineData (images, PDFs) */
export const MAX_MEDIA_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Maximum video file size for visual analysis via inlineData */
export const MAX_VIDEO_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// ─── Base64 Conversion ───────────────────────────────────────

/**
 * Convert ArrayBuffer to base64 string using chunked approach
 * to avoid "Maximum call stack size exceeded" on large files.
 * Extracted from process-note/index.ts (battle-tested).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// ─── Media Type Detection ────────────────────────────────────

/**
 * Detect media type from URL extension or Content-Type header.
 * Supports image, audio, video, and PDF.
 */
export function getMediaType(
  url: string,
  contentType?: string
): "image" | "audio" | "video" | "pdf" | "unknown" {
  if (contentType) {
    if (contentType.startsWith("image/")) return "image";
    if (contentType.startsWith("audio/")) return "audio";
    if (contentType.startsWith("video/")) return "video";
    if (contentType === "application/pdf") return "pdf";
  }

  const urlLower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(urlLower)) return "image";
  if (/\.(mp3|wav|ogg|webm|m4a|aac|opus)(\?|$)/i.test(urlLower)) return "audio";
  if (/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(urlLower)) return "video";
  if (/\.pdf(\?|$)/i.test(urlLower)) return "pdf";

  return "unknown";
}

/**
 * Infer MIME type from a URL. Falls back to "application/octet-stream".
 */
export function inferMimeType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    pdf: "application/pdf",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}

// ─── Media Download & Encoding ───────────────────────────────

export interface MediaPayload {
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Download media from a URL, validate size, and return base64-encoded payload.
 *
 * @param mediaUrl   — Signed URL or public URL to the media file
 * @param maxBytes   — Maximum allowed file size (default: MAX_MEDIA_SIZE_BYTES)
 * @returns MediaPayload or null on failure/oversize
 */
export async function downloadMediaToBase64(
  mediaUrl: string,
  maxBytes: number = MAX_MEDIA_SIZE_BYTES
): Promise<MediaPayload | null> {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      console.warn(
        `[MediaUtils] Download failed: ${response.status} for ${mediaUrl.substring(0, 80)}`
      );
      return null;
    }

    const blob = await response.blob();

    // Size guard
    if (blob.size > maxBytes) {
      console.warn(
        `[MediaUtils] File too large: ${(blob.size / 1024 / 1024).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB limit`
      );
      return null;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    // Determine MIME type: prefer response header, then infer from URL
    const contentType = response.headers.get("content-type") || "";
    const mimeType =
      contentType && contentType !== "application/octet-stream"
        ? contentType.split(";")[0].trim()
        : inferMimeType(mediaUrl);

    console.log(
      `[MediaUtils] Downloaded ${(blob.size / 1024).toFixed(0)}KB, type=${mimeType}`
    );

    return { base64, mimeType, sizeBytes: blob.size };
  } catch (error) {
    console.error("[MediaUtils] Download error:", error);
    return null;
  }
}

// ─── Gemini Payload Helpers ──────────────────────────────────

/**
 * Build Gemini-compatible inlineData parts from media payloads.
 */
export function buildGeminiMediaParts(
  mediaItems: MediaPayload[]
): Array<{ inlineData: { mimeType: string; data: string } }> {
  return mediaItems.map((item) => ({
    inlineData: {
      mimeType: item.mimeType,
      data: item.base64,
    },
  }));
}

// ─── System Prompt Suffix ────────────────────────────────────

/**
 * Appended to the system prompt when visual media is attached.
 * Guides the LLM to analyze images/videos for actionable content.
 */
export const MULTIMODAL_SYSTEM_PROMPT_SUFFIX = `

VISUAL MEDIA ANALYSIS:
You have been provided with visual media. Analyze it thoroughly:
- If it is a receipt or invoice: extract the total amount, merchant, date, and line items
- If it is a screenshot: extract all visible text and describe the context
- If it is a handwritten note or whiteboard: perform OCR and transcribe all text
- If it is a photo of a physical space or object: describe what you see and any actionable details
- If it is a video: analyze the visual content, describe the scene, and extract any text or relevant details
- If it is a document or form: extract key fields and summarize the content
Always be specific about what you observe. Reference the visual content naturally in your response.`;
