import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is missing');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { action, user_id, memory_id, title, content, category, importance, query } = await req.json();

    if (!user_id) {
      throw new Error('Missing required field: user_id');
    }

    console.log('[manage-memories] Action:', action, 'User:', user_id);

    // Helper function to generate embeddings using Lovable AI
    async function generateEmbedding(text: string): Promise<number[] | null> {
      if (!LOVABLE_API_KEY) {
        console.warn('[manage-memories] LOVABLE_API_KEY not configured, skipping embedding');
        return null;
      }

      try {
        // Use Gemini embedding via Lovable AI gateway
        const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-004',
            input: text,
          }),
        });

        if (!response.ok) {
          console.error('[manage-memories] Embedding API error:', response.status);
          return null;
        }

        const data = await response.json();
        return data.data?.[0]?.embedding || null;
      } catch (error) {
        console.error('[manage-memories] Embedding generation error:', error);
        return null;
      }
    }

    switch (action) {
      case 'list': {
        // List all active memories for user
        const { data: memories, error } = await supabase
          .from('user_memories')
          .select('id, title, content, category, importance, created_at, updated_at')
          .eq('user_id', user_id)
          .eq('is_active', true)
          .order('importance', { ascending: false })
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(JSON.stringify({ 
          success: true, 
          memories: memories || [] 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'add': {
        if (!title || !content) {
          throw new Error('Missing required fields: title and content');
        }

        // Generate embedding for semantic search
        const embedding = await generateEmbedding(`${title}\n${content}`);

        const { data: memory, error } = await supabase
          .from('user_memories')
          .insert([{
            user_id,
            title,
            content,
            category: category || 'personal',
            importance: importance || 3,
            embedding,
            metadata: { source: 'manual' },
          }])
          .select('id, title, content, category, importance, created_at')
          .single();

        if (error) throw error;

        console.log('[manage-memories] Created memory:', memory.id);

        return new Response(JSON.stringify({ 
          success: true, 
          memory 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update': {
        if (!memory_id) {
          throw new Error('Missing required field: memory_id');
        }

        const updates: Record<string, any> = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) updates.content = content;
        if (category !== undefined) updates.category = category;
        if (importance !== undefined) updates.importance = importance;

        // Regenerate embedding if title or content changed
        if (title !== undefined || content !== undefined) {
          // First get current memory to merge content
          const { data: existing } = await supabase
            .from('user_memories')
            .select('title, content')
            .eq('id', memory_id)
            .eq('user_id', user_id)
            .single();

          if (existing) {
            const newTitle = title !== undefined ? title : existing.title;
            const newContent = content !== undefined ? content : existing.content;
            const embedding = await generateEmbedding(`${newTitle}\n${newContent}`);
            if (embedding) updates.embedding = embedding;
          }
        }

        const { data: memory, error } = await supabase
          .from('user_memories')
          .update(updates)
          .eq('id', memory_id)
          .eq('user_id', user_id)
          .select('id, title, content, category, importance, created_at, updated_at')
          .single();

        if (error) throw error;

        console.log('[manage-memories] Updated memory:', memory_id);

        return new Response(JSON.stringify({ 
          success: true, 
          memory 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete': {
        if (!memory_id) {
          throw new Error('Missing required field: memory_id');
        }

        // Soft delete by marking as inactive
        const { error } = await supabase
          .from('user_memories')
          .update({ is_active: false })
          .eq('id', memory_id)
          .eq('user_id', user_id);

        if (error) throw error;

        console.log('[manage-memories] Deleted memory:', memory_id);

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Memory deleted' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get_context': {
        // Get memories formatted for AI context (used by process-note and ask-olive)
        const { data: memories, error } = await supabase
          .from('user_memories')
          .select('title, content, category, importance')
          .eq('user_id', user_id)
          .eq('is_active', true)
          .order('importance', { ascending: false })
          .limit(15);

        if (error) throw error;

        // Format memories as context string
        const contextLines = (memories || []).map(m => 
          `- [${m.category}] ${m.title}: ${m.content}`
        );

        const memoryContext = contextLines.length > 0
          ? `USER'S KNOWN MEMORIES AND PREFERENCES:\n${contextLines.join('\n')}`
          : '';

        return new Response(JSON.stringify({ 
          success: true, 
          context: memoryContext,
          count: memories?.length || 0
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'search_relevant': {
        // Semantic search to find memories relevant to a specific task/input
        const inputQuery = query || title || content || '';
        
        if (!inputQuery) {
          return new Response(JSON.stringify({ 
            success: true, 
            context: '',
            count: 0,
            memories: []
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log('[manage-memories] Searching relevant memories for:', inputQuery.substring(0, 100));

        // Generate embedding for the search query
        const queryEmbedding = await generateEmbedding(inputQuery);
        
        if (!queryEmbedding) {
          // Fallback to keyword-based search if embedding fails
          console.log('[manage-memories] Embedding failed, falling back to keyword search');
          
          const keywords = inputQuery.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
          
          const { data: memories, error } = await supabase
            .from('user_memories')
            .select('id, title, content, category, importance')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .order('importance', { ascending: false })
            .limit(20);
          
          if (error) throw error;
          
          // Simple keyword matching
          const relevantMemories = (memories || []).filter((m: any) => {
            const memoryText = `${m.title} ${m.content}`.toLowerCase();
            return keywords.some((k: string) => memoryText.includes(k));
          }).slice(0, 5);
          
          const contextLines = relevantMemories.map((m: any) => 
            `- [${m.category}] ${m.title}: ${m.content}`
          );
          
          return new Response(JSON.stringify({ 
            success: true, 
            context: contextLines.length > 0 
              ? `RELEVANT USER MEMORIES FOR THIS TASK:\n${contextLines.join('\n')}`
              : '',
            count: relevantMemories.length,
            memories: relevantMemories
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Use pgvector similarity search if available
        const { data: similarMemories, error: searchError } = await supabase.rpc(
          'search_user_memories',
          {
            p_user_id: user_id,
            p_query_embedding: JSON.stringify(queryEmbedding),
            p_match_threshold: 0.5, // Lower threshold to catch more relevant matches
            p_match_count: 5
          }
        );

        if (searchError) {
          console.error('[manage-memories] Similarity search error:', searchError);
          // Fallback to importance-based if RPC fails
          const { data: fallbackMemories } = await supabase
            .from('user_memories')
            .select('id, title, content, category, importance')
            .eq('user_id', user_id)
            .eq('is_active', true)
            .order('importance', { ascending: false })
            .limit(5);

          const contextLines = (fallbackMemories || []).map((m: any) => 
            `- [${m.category}] ${m.title}: ${m.content}`
          );

          return new Response(JSON.stringify({ 
            success: true, 
            context: contextLines.length > 0 
              ? `USER'S PREFERENCES:\n${contextLines.join('\n')}`
              : '',
            count: fallbackMemories?.length || 0,
            memories: fallbackMemories || []
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log('[manage-memories] Found', similarMemories?.length || 0, 'relevant memories via similarity search');

        const contextLines = (similarMemories || []).map((m: any) => 
          `- [${m.category}] ${m.title}: ${m.content} (relevance: ${Math.round(m.similarity * 100)}%)`
        );

        return new Response(JSON.stringify({ 
          success: true, 
          context: contextLines.length > 0 
            ? `RELEVANT USER MEMORIES FOR THIS TASK:\n${contextLines.join('\n')}`
            : '',
          count: similarMemories?.length || 0,
          memories: similarMemories || []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('[manage-memories] Error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error?.message || 'Unknown error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
