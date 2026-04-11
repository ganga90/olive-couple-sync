/**
 * Server-Side Encryption Module for Olive
 * ========================================
 * AES-256-GCM field-level encryption using Web Crypto API.
 * 
 * Key derivation: HMAC-SHA256(ENCRYPTION_MASTER_KEY, user_id) → per-user 256-bit key
 * Format: base64(iv:ciphertext:tag) — 12-byte IV, AES-256-GCM
 * 
 * Gracefully degrades: if ENCRYPTION_MASTER_KEY is not set, encrypt/decrypt are no-ops.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Check if encryption is available (master key is configured)
 */
export function isEncryptionAvailable(): boolean {
  return !!Deno.env.get('ENCRYPTION_MASTER_KEY');
}

/**
 * Derive a per-user AES-256-GCM key from the master key + user ID.
 * Uses HMAC-SHA256 to produce a deterministic 256-bit key per user.
 */
async function deriveUserKey(userId: string): Promise<CryptoKey> {
  const masterKeyHex = Deno.env.get('ENCRYPTION_MASTER_KEY');
  if (!masterKeyHex) {
    throw new Error('ENCRYPTION_MASTER_KEY not configured');
  }

  // Import master key for HMAC
  const masterKeyBytes = hexToBytes(masterKeyHex);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    masterKeyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Derive per-user key material via HMAC-SHA256(masterKey, userId)
  const derivedBytes = await crypto.subtle.sign(
    'HMAC',
    baseKey,
    encoder.encode(userId)
  );

  // Import the derived bytes as an AES-256-GCM key
  return crypto.subtle.importKey(
    'raw',
    derivedBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext using AES-256-GCM with a per-user key.
 * Returns a base64-encoded string in format: iv:ciphertext (IV is prepended to ciphertext).
 * 
 * If encryption is not available, returns null (caller should store plaintext).
 */
export async function encrypt(plaintext: string, userId: string): Promise<string | null> {
  if (!isEncryptionAvailable()) {
    console.warn('[encryption] ENCRYPTION_MASTER_KEY not set, skipping encryption');
    return null;
  }

  try {
    const key = await deriveUserKey(userId);
    
    // Generate random 12-byte IV (recommended for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    );

    // Combine IV + ciphertext into a single buffer, then base64 encode
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return bytesToBase64(combined);
  } catch (error) {
    console.error('[encryption] Encryption failed:', error);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM with a per-user key.
 * Expects a base64-encoded string where first 12 bytes are IV.
 * 
 * If encryption is not available or ciphertext is null, returns null.
 */
export async function decrypt(ciphertext: string, userId: string): Promise<string | null> {
  if (!ciphertext) return null;
  
  if (!isEncryptionAvailable()) {
    console.warn('[encryption] ENCRYPTION_MASTER_KEY not set, cannot decrypt');
    return null;
  }

  try {
    const key = await deriveUserKey(userId);
    
    const combined = base64ToBytes(ciphertext);
    
    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encryptedData
    );

    return decoder.decode(plaintext);
  } catch (error) {
    console.error('[encryption] Decryption failed:', error);
    throw new Error('Decryption failed - data may be corrupted or key mismatch');
  }
}

/**
 * Encrypt note fields if the note is marked as sensitive.
 * Returns the fields to set on the DB row.
 */
export async function encryptNoteFields(
  originalText: string,
  summary: string,
  userId: string,
  isSensitive: boolean
): Promise<{
  original_text: string;
  summary: string;
  encrypted_original_text: string | null;
  encrypted_summary: string | null;
  is_sensitive: boolean;
}> {
  if (!isSensitive || !isEncryptionAvailable()) {
    return {
      original_text: originalText,
      summary,
      encrypted_original_text: null,
      encrypted_summary: null,
      is_sensitive: isSensitive,
    };
  }

  const encryptedText = await encrypt(originalText, userId);
  const encryptedSummary = await encrypt(summary, userId);

  return {
    original_text: '[ENCRYPTED]',
    summary: '[ENCRYPTED]',
    encrypted_original_text: encryptedText,
    encrypted_summary: encryptedSummary,
    is_sensitive: true,
  };
}

/**
 * Decrypt note fields if the note is sensitive and encrypted.
 * Returns plaintext original_text and summary.
 */
export async function decryptNoteFields(
  note: {
    original_text: string;
    summary: string;
    encrypted_original_text?: string | null;
    encrypted_summary?: string | null;
    is_sensitive?: boolean;
    author_id?: string;
  },
  userId: string
): Promise<{ original_text: string; summary: string }> {
  if (!note.is_sensitive || !note.encrypted_original_text) {
    return { original_text: note.original_text, summary: note.summary };
  }

  const decryptedText = await decrypt(note.encrypted_original_text, userId) || note.original_text;
  const decryptedSummary = note.encrypted_summary 
    ? (await decrypt(note.encrypted_summary, userId) || note.summary)
    : note.summary;

  return { original_text: decryptedText, summary: decryptedSummary };
}

// ─── Utility functions ────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
