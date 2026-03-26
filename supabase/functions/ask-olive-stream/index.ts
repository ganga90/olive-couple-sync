/**
 * ASK-OLIVE-STREAM Edge Function
 * ============================================================================
 * Streaming version of ask-olive for real-time token-by-token responses.
 * Uses SSE (Server-Sent Events) for streaming.
 * 
 * Now enriched with server-side context: memories, profile, patterns,
 * calendar events, and recent activity for deeply personalized responses.
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
- Deliver the most useful, actionable, and accurate response based on the user's full context
- Reference specific items from the user's saved data when relevant
- Use memories and preferences to personalize every response
- Be concise, friendly, and clear—your tone should be encouraging, approachable, and smart
- Use markdown formatting for better readability

Guidelines:
1. Personality: Warm, optimistic, respectful—like a knowledgeable friend
2. Direct Support: Immediately provide your best answer or recommendation
3. Keep responses focused and actionable
4. Use **bold** for emphasis, bullet points for lists, numbered lists for steps
5. When user context is provided, ALWAYS reference relevant saved items, memories, and preferences
6. Track conversation history for continuity—don't repeat yourself or ask questions already answered
7. If the user mentions something that connects to their saved data, make the connection explicitly`;

/**
 * Fetch server-side context for deep personalization
 */
async function fetchServerContext(userId: string, coupleId?: string): Promise<string> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return '';
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const contextParts: string[] = [];
  
  try {
    // Parallel fetch: memories, profile, patterns, recent notes, calendar
    const [memoriesRes, profileRes, patternsRes, recentNotesRes, calendarRes] = await Promise.all([
      // User memories (top 15 by importance)
      supabase
        .from('user_memories')
        .select('title, content, category, importance')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('importance', { ascending: false })
        .limit(15),
      
      // User profile
      supabase
        .from('clerk_profiles')
        .select('display_name, language_preference, timezone, note_style')
        .eq('id', userId)
        .maybeSingle(),
      
      // Active behavioral patterns
      supabase
        .from('olive_patterns')
        .select('pattern_type, pattern_data, confidence')
        .eq('user_id', userId)
        .eq('is_active', true)
        .gte('confidence', 0.6)
        .limit(10),
      
      // Recent notes for activity awareness (last 7 days)
      supabase
        .from('clerk_notes')
        .select('summary, category, completed, priority, due_date, created_at')
        .or(
          coupleId 
            ? `couple_id.eq.${coupleId},and(author_id.eq.${userId},couple_id.is.null)`
            : `author_id.eq.${userId}`
        )
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(30),
      
      // Upcoming calendar events (next 14 days)
      supabase
        .from('calendar_events')
        .select('title, start_time, end_time, location, connection_id')
        .gte('start_time', new Date().toISOString())
        .lte('start_time', new Date(Date.now() + 14 * 86400000).toISOString())
        .order('start_time', { ascending: true })
        .limit(15),
    ]);

    // Profile context
    if (profileRes.data) {
      const p = profileRes.data;
      contextParts.push(`USER PROFILE: Name: ${p.display_name || 'Unknown'}, Language: ${p.language_preference || 'en'}, Timezone: ${p.timezone || 'UTC'}, Note style: ${p.note_style || 'auto'}`);
    }

    // Memory context
    if (memoriesRes.data?.length) {
      const memoryLines = memoriesRes.data.map(m => `- [${m.category}] ${m.title}: ${m.content}`);
      contextParts.push(`\nUSER MEMORIES & PREFERENCES:\n${memoryLines.join('\n')}`);
    }

    // Pattern context
    if (patternsRes.data?.length) {
      const patternLines = patternsRes.data.map(p => 
        `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (confidence: ${(p.confidence * 100).toFixed(0)}%)`
      );
      contextParts.push(`\nBEHAVIORAL PATTERNS:\n${patternLines.join('\n')}`);
    }

    // Recent activity
    if (recentNotesRes.data?.length) {
      const activeCount = recentNotesRes.data.filter(n => !n.completed).length;
      const urgentCount = recentNotesRes.data.filter(n => n.priority === 'high').length;
      const overdueCount = recentNotesRes.data.filter(n => {
        if (!n.due_date) return false;
        return new Date(n.due_date) < new Date();
      }).length;
      
      contextParts.push(`\nACTIVITY SNAPSHOT: ${activeCount} active tasks, ${urgentCount} urgent, ${overdueCount} overdue`);
      
      // Categories breakdown
      const cats = new Map<string, number>();
      recentNotesRes.data.forEach(n => cats.set(n.category, (cats.get(n.category) || 0) + 1));
      const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topCats.length) {
        contextParts.push(`Top categories: ${topCats.map(([c, n]) => `${c}(${n})`).join(', ')}`);
      }
    }

    // Calendar context
    if (calendarRes.data?.length) {
      const eventLines = calendarRes.data.slice(0, 8).map(e => {
        const date = new Date(e.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const time = new Date(e.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `- ${date} ${time}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`;
      });
      contextParts.push(`\nUPCOMING CALENDAR:\n${eventLines.join('\n')}`);
    }

    // Memory file context (profile file for deeper personalization)
    try {
      const { data: memoryFile } = await supabase
        .from('olive_memory_files')
        .select('content')
        .eq('user_id', userId)
        .eq('file_type', 'profile')
        .maybeSingle();
      
      if (memoryFile?.content) {
        contextParts.push(`\nDEEP PROFILE:\n${memoryFile.content.slice(0, 800)}`);
      }
    } catch { /* non-critical */ }

  } catch (err) {
    console.error('[ask-olive-stream] Context fetch error:', err);
  }
  
  return contextParts.join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, context, user_id, couple_id } = await req.json();

    if (!GEMINI_KEY) {
      throw new Error('GEMINI_API key not configured');
    }

    // Fetch server-side context in parallel with building frontend context
    const serverContextPromise = fetchServerContext(user_id, couple_id);

    // Build context from frontend-provided data
    let fullContext = '';
    
    // Add server-side context (memories, profile, patterns, calendar)
    const serverContext = await serverContextPromise;
    if (serverContext) {
      fullContext += `${serverContext}\n\n`;
    }
    
    // Add frontend-provided saved items context
    if (context?.saved_items_context) {
      fullContext += `USER'S SAVED DATA:\n${context.saved_items_context}\n\n`;
    }
    
    // Add user name if available
    if (context?.user_name) {
      fullContext += `User's name: ${context.user_name}\n\n`;
    }
    
    // Add conversation history
    if (context?.conversation_history?.length) {
      const history = context.conversation_history
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n');
      fullContext += `CONVERSATION HISTORY:\n${history}\n\n`;
    }
    
    fullContext += `USER MESSAGE: ${message}`;

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
