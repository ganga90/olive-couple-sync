/**
 * ASK-OLIVE-STREAM Edge Function
 * ============================================================================
 * Streaming version of ask-olive for real-time token-by-token responses.
 * Uses SSE (Server-Sent Events) for streaming.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OLIVE_SYSTEM_PROMPT = `You are Olive, a friendly and intelligent AI assistant within the Olive app. Your purpose is to help couples and individuals manage everyday tasks, ideas, notes, and saved items with intelligence and empathy.

Core Objectives:
- Deliver the most useful, actionable, and accurate response based on the user's context
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Use markdown formatting for better readability

Guidelines:
1. Personality: Warm, optimistic, respectful
2. Direct Support: Immediately provide your best answer or recommendation
3. Keep responses focused and actionable
4. Use **bold** for emphasis, bullet points for lists, numbered lists for steps`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, context, user_id, couple_id } = await req.json();

    if (!GEMINI_KEY) {
      throw new Error('GEMINI_API key not configured');
    }

    // Build context from user's saved data
    let fullContext = message;
    if (context?.saved_items_context) {
      fullContext = `USER CONTEXT:\n${context.saved_items_context}\n\nUSER MESSAGE: ${message}`;
    }
    if (context?.conversation_history?.length) {
      const history = context.conversation_history
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n');
      fullContext = `CONVERSATION HISTORY:\n${history}\n\n${fullContext}`;
    }

    // Use streaming with Gemini
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${getModel('standard')}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: fullContext }] }],
          systemInstruction: { parts: [{ text: OLIVE_SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048
          }
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ask-olive-stream] Gemini error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    // Stream the response back to the client
    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('[ask-olive-stream] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
