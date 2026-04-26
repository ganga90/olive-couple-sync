/**
 * Repair Embeddings
 *
 * One-time / on-demand utility to back-fill NULL embeddings.
 * Can also be scheduled via pg_cron to catch any future NULL embeddings.
 *
 * Actions:
 *   - status: Counts of user_memories with/without embeddings
 *   - status_notes: Counts of clerk_notes with/without embeddings (system-wide,
 *                   broken down by NULL vs populated). Use to scope a backfill.
 *   - repair_user_memories: Re-embed all user_memories with NULL embeddings
 *   - repair_clerk_notes: Re-embed clerk_notes with NULL embeddings.
 *                         Optional body params:
 *                           - batch_size (default 25, max 100)
 *                           - user_id (text, optional — restrict to one user)
 *                           - couple_id (uuid, optional — restrict to one couple/space)
 *                         Returns { repaired, failed, remaining }. Re-invoke
 *                         until remaining = 0 to back-fill the whole table.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function generateEmbedding(text: string): Promise<number[] | null> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!GEMINI_API_KEY) {
    console.error("[repair-embeddings] No Gemini API key configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!response.ok) {
      console.error("[repair-embeddings] Gemini embedding API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.embedding?.values || null;
  } catch (e) {
    console.error("[repair-embeddings] Embedding generation failed:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";
    const batchSize = body.batch_size || 10;

    if (action === "status") {
      const { data, error } = await supabase
        .from("user_memories")
        .select("id, embedding, is_active", { count: "exact" });

      if (error) throw error;

      const total = data?.length || 0;
      const withEmbedding = data?.filter((m: any) => m.embedding !== null).length || 0;
      const nullEmbeddings = total - withEmbedding;
      const active = data?.filter((m: any) => m.is_active).length || 0;

      return new Response(
        JSON.stringify({
          success: true,
          status: { total, with_embedding: withEmbedding, null_embeddings: nullEmbeddings, active },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status_notes") {
      // System-wide counts of clerk_notes embeddings (cheap: head:true count queries)
      const { count: total } = await supabase
        .from("clerk_notes")
        .select("id", { count: "exact", head: true });
      const { count: withEmbedding } = await supabase
        .from("clerk_notes")
        .select("id", { count: "exact", head: true })
        .not("embedding", "is", null);
      const { count: nullEmbeddings } = await supabase
        .from("clerk_notes")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      const { count: nullEmbeddingsWithText } = await supabase
        .from("clerk_notes")
        .select("id", { count: "exact", head: true })
        .is("embedding", null)
        .not("original_text", "is", null);

      return new Response(
        JSON.stringify({
          success: true,
          status: {
            total: total ?? 0,
            with_embedding: withEmbedding ?? 0,
            null_embeddings: nullEmbeddings ?? 0,
            null_with_text: nullEmbeddingsWithText ?? 0, // candidates for backfill
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "repair_clerk_notes") {
      const reqBatchSize = Math.min(Math.max(Number(body.batch_size ?? 25), 1), 100);
      const restrictUserId: string | undefined = body.user_id;
      const restrictCoupleId: string | undefined = body.couple_id;

      // Build query: NULL embeddings, system-wide, optionally restricted.
      // Use summary OR original_text — even title-only notes are worth embedding.
      let q = supabase
        .from("clerk_notes")
        .select("id, summary, original_text, author_id, couple_id")
        .is("embedding", null);

      // If both user_id and couple_id are provided, treat as OR (the same scoping
      // the webhook uses). If only one, restrict by that one.
      if (restrictUserId && restrictCoupleId) {
        q = q.or(`author_id.eq.${restrictUserId},couple_id.eq.${restrictCoupleId}`);
      } else if (restrictUserId) {
        q = q.eq("author_id", restrictUserId);
      } else if (restrictCoupleId) {
        q = q.eq("couple_id", restrictCoupleId);
      }

      // Use the partial index idx_notes_null_embedding for ordering — created_at DESC
      // is the cheapest ordering for that index.
      const { data: notes, error: selErr } = await q
        .order("created_at", { ascending: false })
        .limit(reqBatchSize);

      if (selErr) throw selErr;
      if (!notes || notes.length === 0) {
        return new Response(
          JSON.stringify({ success: true, repaired: 0, failed: 0, remaining: 0, message: "No NULL embeddings found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[repair-embeddings] Repairing ${notes.length} clerk_notes (batch_size=${reqBatchSize})`);

      let repaired = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const note of notes as Array<{ id: string; summary: string | null; original_text: string | null }>) {
        // Combine summary + original_text. If they're identical (a brain-dump where
        // the user just typed a title), use only the summary to keep the embedding
        // signal clean. Skip notes with no usable text.
        const summary = (note.summary || "").trim();
        const originalText = (note.original_text || "").trim();
        const text =
          summary && originalText && summary !== originalText
            ? `${summary}\n${originalText}`
            : (summary || originalText);

        if (!text) {
          failed++;
          errors.push(`${note.id}: empty_text`);
          continue;
        }

        try {
          const embedding = await generateEmbedding(text);
          if (!embedding) {
            failed++;
            errors.push(`${note.id}: embedding_returned_null`);
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }

          const { error: updateError } = await supabase
            .from("clerk_notes")
            .update({ embedding: JSON.stringify(embedding) })
            .eq("id", note.id);

          if (updateError) {
            failed++;
            errors.push(`${note.id}: ${updateError.message}`);
          } else {
            repaired++;
          }

          // Rate limit: 100ms between API calls (matches user_memories repair)
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          failed++;
          errors.push(`${note.id}: ${e instanceof Error ? e.message : "unknown"}`);
        }
      }

      // Remaining count (respect the same scope filter)
      let remainingQ = supabase
        .from("clerk_notes")
        .select("id", { count: "exact", head: true })
        .is("embedding", null);
      if (restrictUserId && restrictCoupleId) {
        remainingQ = remainingQ.or(`author_id.eq.${restrictUserId},couple_id.eq.${restrictCoupleId}`);
      } else if (restrictUserId) {
        remainingQ = remainingQ.eq("author_id", restrictUserId);
      } else if (restrictCoupleId) {
        remainingQ = remainingQ.eq("couple_id", restrictCoupleId);
      }
      const { count: remaining } = await remainingQ;

      console.log(`[repair-embeddings] Batch done: repaired=${repaired} failed=${failed} remaining=${remaining ?? 0}`);

      return new Response(
        JSON.stringify({
          success: true,
          repaired,
          failed,
          remaining: remaining ?? 0,
          errors: errors.slice(0, 10),
          next_action:
            (remaining ?? 0) > 0
              ? `Re-invoke repair_clerk_notes with same params; ~${Math.ceil((remaining ?? 0) / reqBatchSize)} batches remaining`
              : "Complete",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "repair_user_memories") {
      // Fetch memories with NULL embeddings
      const { data: memories, error } = await supabase
        .from("user_memories")
        .select("id, title, content")
        .is("embedding", null)
        .eq("is_active", true)
        .limit(batchSize);

      if (error) throw error;
      if (!memories || memories.length === 0) {
        return new Response(
          JSON.stringify({ success: true, repaired: 0, message: "No NULL embeddings found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[repair-embeddings] Repairing ${memories.length} memories with NULL embeddings`);

      let repaired = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const memory of memories) {
        const text = `${memory.title}\n${memory.content}`;

        try {
          const embedding = await generateEmbedding(text);
          if (embedding) {
            const { error: updateError } = await supabase
              .from("user_memories")
              .update({ embedding, updated_at: new Date().toISOString() })
              .eq("id", memory.id);

            if (updateError) {
              failed++;
              errors.push(`${memory.id}: ${updateError.message}`);
            } else {
              repaired++;
              console.log(`[repair-embeddings] Repaired memory ${memory.id}`);
            }
          } else {
            failed++;
            errors.push(`${memory.id}: embedding generation returned null`);
          }

          // Rate limit: 100ms between API calls
          await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
          failed++;
          errors.push(`${memory.id}: ${e instanceof Error ? e.message : "unknown error"}`);
        }
      }

      // Check remaining
      const { count } = await supabase
        .from("user_memories")
        .select("id", { count: "exact", head: true })
        .is("embedding", null)
        .eq("is_active", true);

      return new Response(
        JSON.stringify({
          success: true,
          repaired,
          failed,
          remaining: count || 0,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error("[repair-embeddings] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
