/**
 * Repair Embeddings
 *
 * One-time / on-demand utility to back-fill NULL embeddings in user_memories.
 * Can also be scheduled via pg_cron to catch any future NULL embeddings.
 *
 * Actions:
 *   - repair_user_memories: Re-embed all user_memories with NULL embeddings
 *   - status: Return counts of memories with/without embeddings
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text }] },
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
