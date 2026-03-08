/**
 * Decrypt Note Edge Function
 * ==========================
 * Securely decrypts sensitive note fields server-side.
 * The encryption key never leaves the Edge Function runtime.
 * 
 * Validates user ownership before decrypting.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt, isEncryptionAvailable } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { note_id, user_id } = await req.json();

    if (!note_id || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: note_id, user_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isEncryptionAvailable()) {
      return new Response(
        JSON.stringify({ error: 'Encryption not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch the note using service role (bypasses RLS)
    const { data: note, error: fetchError } = await supabase
      .from('clerk_notes')
      .select('id, author_id, couple_id, original_text, summary, encrypted_original_text, encrypted_summary, is_sensitive')
      .eq('id', note_id)
      .single();

    if (fetchError || !note) {
      return new Response(
        JSON.stringify({ error: 'Note not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate ownership: user must be author OR couple member
    let authorized = note.author_id === user_id;
    
    if (!authorized && note.couple_id) {
      const { data: membership } = await supabase
        .from('clerk_couple_members')
        .select('id')
        .eq('couple_id', note.couple_id)
        .eq('user_id', user_id)
        .maybeSingle();
      
      authorized = !!membership;
    }

    if (!authorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If not sensitive or no encrypted content, return as-is
    if (!note.is_sensitive || !note.encrypted_original_text) {
      return new Response(
        JSON.stringify({
          note_id: note.id,
          original_text: note.original_text,
          summary: note.summary,
          is_sensitive: note.is_sensitive || false,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt using the note author's key (encryption is per-author)
    const decryptUserId = note.author_id || user_id;
    
    const decryptedText = await decrypt(note.encrypted_original_text, decryptUserId);
    const decryptedSummary = note.encrypted_summary 
      ? await decrypt(note.encrypted_summary, decryptUserId)
      : note.summary;

    // Audit log for compliance
    await supabase.from('decryption_audit_log').insert({
      user_id,
      note_id,
      function_name: 'decrypt-note',
    });

    return new Response(
      JSON.stringify({
        note_id: note.id,
        original_text: decryptedText || note.original_text,
        summary: decryptedSummary || note.summary,
        is_sensitive: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[decrypt-note] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Decryption failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
