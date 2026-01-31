/**
 * Olive Memory Service
 *
 * Manages persistent, file-based memory system inspired by Moltbot.
 * Handles memory files, chunks, pattern detection, and context building.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Types
interface MemoryFile {
  id: string;
  user_id: string;
  couple_id?: string;
  file_type: 'profile' | 'daily' | 'patterns' | 'relationship' | 'household';
  file_date?: string;
  content: string;
  token_count: number;
  metadata: Record<string, any>;
}

interface MemoryChunk {
  id: string;
  memory_file_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  chunk_type: 'fact' | 'event' | 'decision' | 'pattern' | 'interaction';
  importance: number;
  source: string;
}

interface Pattern {
  id: string;
  user_id: string;
  couple_id?: string;
  pattern_type: string;
  pattern_data: Record<string, any>;
  confidence: number;
  sample_count: number;
}

// Action handlers
type ActionHandler = (supabase: any, params: any, userId: string) => Promise<any>;

const actions: Record<string, ActionHandler> = {
  /**
   * Get or create a memory file
   */
  async get_file(supabase, params, userId) {
    const { file_type, file_date, couple_id } = params;

    const { data, error } = await supabase.rpc('get_or_create_memory_file', {
      p_user_id: userId,
      p_file_type: file_type,
      p_file_date: file_date || null,
      p_couple_id: couple_id || null,
    });

    if (error) throw error;
    return { file: data };
  },

  /**
   * Read a memory file
   */
  async read_file(supabase, params, userId) {
    const { file_type, file_date } = params;

    let query = supabase
      .from('olive_memory_files')
      .select('*')
      .eq('user_id', userId)
      .eq('file_type', file_type);

    if (file_date) {
      query = query.eq('file_date', file_date);
    } else {
      query = query.is('file_date', null);
    }

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') throw error;
    return { file: data || null };
  },

  /**
   * Write/update a memory file
   */
  async write_file(supabase, params, userId) {
    const { file_type, file_date, content, metadata, couple_id } = params;

    // Estimate token count (rough: 4 chars per token)
    const token_count = Math.ceil(content.length / 4);

    // Generate content hash for change detection
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const content_hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: file, error } = await supabase
      .from('olive_memory_files')
      .upsert({
        user_id: userId,
        couple_id: couple_id || null,
        file_type,
        file_date: file_date || null,
        content,
        content_hash,
        token_count,
        metadata: metadata || {},
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,file_type,file_date',
      })
      .select()
      .single();

    if (error) throw error;
    return { file, updated: true };
  },

  /**
   * Append to daily log
   */
  async append_daily(supabase, params, userId) {
    const { content, source = 'app' } = params;

    const { data, error } = await supabase.rpc('append_to_daily_log', {
      p_user_id: userId,
      p_content: content,
      p_source: source,
    });

    if (error) throw error;
    return { file: data, appended: true };
  },

  /**
   * Add a memory chunk
   */
  async add_chunk(supabase, params, userId) {
    const {
      file_type,
      file_date,
      content,
      chunk_type = 'fact',
      importance = 3,
      source = 'auto',
      metadata = {},
    } = params;

    // First, get or create the memory file
    const { data: file } = await supabase.rpc('get_or_create_memory_file', {
      p_user_id: userId,
      p_file_type: file_type,
      p_file_date: file_date || null,
    });

    // Get next chunk index
    const { data: lastChunk } = await supabase
      .from('olive_memory_chunks')
      .select('chunk_index')
      .eq('memory_file_id', file.id)
      .order('chunk_index', { ascending: false })
      .limit(1)
      .single();

    const chunkIndex = (lastChunk?.chunk_index || 0) + 1;

    // Generate embedding for the chunk
    let embedding = null;
    try {
      embedding = await generateEmbedding(content);
    } catch (e) {
      console.error('Failed to generate embedding:', e);
    }

    // Insert chunk
    const { data: chunk, error } = await supabase
      .from('olive_memory_chunks')
      .insert({
        memory_file_id: file.id,
        user_id: userId,
        chunk_index: chunkIndex,
        content,
        chunk_type,
        importance,
        embedding,
        source,
        metadata,
      })
      .select()
      .single();

    if (error) throw error;
    return { chunk, file_id: file.id };
  },

  /**
   * Search memory chunks semantically
   */
  async search_chunks(supabase, params, userId) {
    const { query, limit = 10, min_importance = 1 } = params;

    // Generate embedding for query
    const embedding = await generateEmbedding(query);

    const { data, error } = await supabase.rpc('search_memory_chunks', {
      p_user_id: userId,
      p_query_embedding: embedding,
      p_match_count: limit,
      p_min_importance: min_importance,
    });

    if (error) throw error;
    return { chunks: data || [] };
  },

  /**
   * Get user's full memory context for AI
   */
  async get_context(supabase, params, userId) {
    const { couple_id, include_daily = true } = params;

    const { data, error } = await supabase.rpc('get_user_memory_context', {
      p_user_id: userId,
      p_couple_id: couple_id || null,
      p_include_daily: include_daily,
    });

    if (error) throw error;
    return { context: data };
  },

  /**
   * Flush conversation context to memory
   * Extracts important facts and stores them
   */
  async flush_context(supabase, params, userId) {
    const { conversation, source = 'conversation' } = params;

    // Use AI to extract memorable facts
    const extractedFacts = await extractMemorableFacts(conversation);

    if (!extractedFacts || extractedFacts.length === 0) {
      return { extracted: 0, facts: [] };
    }

    const results = [];

    for (const fact of extractedFacts) {
      try {
        // Add to appropriate file based on type
        let file_type: string;
        if (fact.type === 'preference' || fact.type === 'personal_info') {
          file_type = 'profile';
        } else if (fact.type === 'pattern') {
          file_type = 'patterns';
        } else {
          file_type = 'daily';
        }

        // Add as chunk
        const { data: chunk } = await supabase
          .from('olive_memory_chunks')
          .insert({
            memory_file_id: null, // Will be linked later
            user_id: userId,
            chunk_index: 0,
            content: fact.content,
            chunk_type: fact.type === 'pattern' ? 'pattern' : 'fact',
            importance: fact.importance || 3,
            source,
            metadata: { extracted_at: new Date().toISOString() },
          })
          .select()
          .single();

        results.push(chunk);

        // Also append to profile if it's a preference
        if (file_type === 'profile' && fact.importance >= 4) {
          await supabase.rpc('get_or_create_memory_file', {
            p_user_id: userId,
            p_file_type: 'profile',
          });

          await supabase
            .from('olive_memory_files')
            .update({
              content: supabase.raw(`content || E'\n- ' || '${fact.content.replace(/'/g, "''")}'`),
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('file_type', 'profile');
        }
      } catch (e) {
        console.error('Failed to store fact:', e);
      }
    }

    return { extracted: results.length, facts: results };
  },

  /**
   * Update a behavioral pattern
   */
  async update_pattern(supabase, params, userId) {
    const { pattern_type, observation, couple_id } = params;

    const { data, error } = await supabase.rpc('update_pattern', {
      p_user_id: userId,
      p_pattern_type: pattern_type,
      p_observation: observation,
      p_couple_id: couple_id || null,
    });

    if (error) throw error;
    return { pattern: data };
  },

  /**
   * Get active patterns for a user
   */
  async get_patterns(supabase, params, userId) {
    const { min_confidence = 0.5 } = params;

    const { data, error } = await supabase
      .from('olive_patterns')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .gte('confidence', min_confidence)
      .order('confidence', { ascending: false });

    if (error) throw error;
    return { patterns: data || [] };
  },

  /**
   * Get recent daily logs
   */
  async get_recent_logs(supabase, params, userId) {
    const { days = 7 } = params;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('olive_memory_files')
      .select('*')
      .eq('user_id', userId)
      .eq('file_type', 'daily')
      .gte('file_date', startDate.toISOString().split('T')[0])
      .order('file_date', { ascending: false });

    if (error) throw error;
    return { logs: data || [] };
  },

  /**
   * Initialize memory for a new user
   */
  async initialize_user(supabase, params, userId) {
    const { couple_id } = params;

    // Create profile file
    await supabase.rpc('get_or_create_memory_file', {
      p_user_id: userId,
      p_file_type: 'profile',
    });

    // Create patterns file
    await supabase.rpc('get_or_create_memory_file', {
      p_user_id: userId,
      p_file_type: 'patterns',
    });

    // Create today's daily log
    await supabase.rpc('get_or_create_memory_file', {
      p_user_id: userId,
      p_file_type: 'daily',
      p_file_date: new Date().toISOString().split('T')[0],
    });

    // Initialize preferences
    await supabase
      .from('olive_user_preferences')
      .upsert({
        user_id: userId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    return { initialized: true };
  },

  /**
   * Get user preferences
   */
  async get_preferences(supabase, params, userId) {
    const { data, error } = await supabase
      .from('olive_user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return { preferences: data || getDefaultPreferences(userId) };
  },

  /**
   * Update user preferences
   */
  async update_preferences(supabase, params, userId) {
    const { preferences } = params;

    const { data, error } = await supabase
      .from('olive_user_preferences')
      .upsert({
        user_id: userId,
        ...preferences,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single();

    if (error) throw error;
    return { preferences: data };
  },
};

// Helper: Generate embedding via Lovable proxy or fallback
async function generateEmbedding(text: string): Promise<number[]> {
  // Try Lovable's embedding endpoint
  const LOVABLE_API_URL = Deno.env.get('LOVABLE_API_URL') || 'https://lovable.dev/api';

  try {
    const response = await fetch(`${LOVABLE_API_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data?.[0]?.embedding || data.embedding;
    }
  } catch (e) {
    console.error('Lovable embedding failed:', e);
  }

  // Fallback: Use OpenAI directly if key available
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-3-small',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data[0].embedding;
    }
  }

  throw new Error('No embedding service available');
}

// Helper: Extract memorable facts from conversation using AI
async function extractMemorableFacts(conversation: string): Promise<Array<{
  content: string;
  type: 'preference' | 'fact' | 'pattern' | 'personal_info';
  importance: number;
}>> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('VITE_GEMINI_API_KEY');

  if (!GEMINI_API_KEY) {
    console.log('No Gemini API key, skipping fact extraction');
    return [];
  }

  const prompt = `Analyze this conversation and extract memorable facts worth storing in long-term memory.

Conversation:
${conversation}

Extract facts that are:
- User preferences (how they like things done)
- Personal information (names, dates, locations)
- Patterns (recurring behaviors or schedules)
- Important decisions made

For each fact, provide:
- content: The fact in a concise statement
- type: One of "preference", "fact", "pattern", "personal_info"
- importance: 1-5 (5 being most important)

Return as JSON array. If no memorable facts, return empty array.
Example: [{"content": "Prefers morning reminders at 8am", "type": "preference", "importance": 4}]`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error('Gemini API error:', await response.text());
      return [];
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('Fact extraction failed:', e);
  }

  return [];
}

// Helper: Get default preferences
function getDefaultPreferences(userId: string) {
  return {
    user_id: userId,
    proactive_enabled: true,
    max_daily_messages: 5,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    morning_briefing_enabled: true,
    morning_briefing_time: '08:00',
    evening_review_enabled: false,
    evening_review_time: '20:00',
    weekly_summary_enabled: true,
    weekly_summary_day: 0,
    weekly_summary_time: '19:00',
    memory_auto_extract: true,
    memory_retention_days: 365,
    daily_log_enabled: true,
    partner_sync_enabled: false,
    reminder_advance_minutes: 30,
    overdue_nudge_enabled: true,
    pattern_suggestions_enabled: true,
  };
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Create client with user's token for RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get user ID from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    let userId: string;

    if (authError || !user) {
      // Try to get user ID from request body for service-to-service calls
      const body = await req.json();
      if (body.user_id) {
        userId = body.user_id;
      } else {
        throw new Error("Invalid authorization");
      }
    } else {
      userId = user.id;
    }

    // Re-parse body if needed
    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { action, ...params } = body;

    if (!action) {
      throw new Error("Missing action parameter");
    }

    const handler = actions[action];
    if (!handler) {
      throw new Error(`Unknown action: ${action}`);
    }

    // Execute action with service role client for full access
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const result = await handler(serviceClient, params, userId);

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Memory service error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
