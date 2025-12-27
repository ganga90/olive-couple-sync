import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Intent categories
type IntentCategory = 'BOOK_MEDIA' | 'LOCAL_PLACE' | 'NAVIGATIONAL' | 'GENERAL_TASK';

interface TipData {
  status: 'generated' | 'error';
  type: 'book' | 'place' | 'action' | 'general';
  generated_at: string;
  title: string;
  summary: string;
  actions: Array<{
    label: string;
    url: string;
    type: 'primary' | 'secondary';
    icon?: string;
  }>;
  metadata?: {
    image?: string;
    rating?: number;
    phone?: string;
    address?: string;
    price?: string;
    author?: string;
    source?: string;
  };
}

// Analyze images using Gemini Vision to extract text and context
async function analyzeImages(imageUrls: string[]): Promise<string> {
  if (!imageUrls || imageUrls.length === 0) {
    return '';
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.log('LOVABLE_API_KEY not configured, skipping image analysis');
    return '';
  }

  try {
    // Take first 3 images max to avoid token limits
    const imagesToAnalyze = imageUrls.slice(0, 3);
    console.log(`[Image Analysis] Analyzing ${imagesToAnalyze.length} images`);

    // Build content array with images for vision model
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      {
        type: 'text',
        text: `Analyze these images and extract ALL relevant information that would help identify what the user needs to do or find. Focus on:

1. TEXT/OCR: Extract ALL visible text (titles, names, brands, addresses, phone numbers, websites, prices)
2. OBJECTS: Identify key objects (book covers, products, business cards, receipts, menus, signs)
3. CONTEXT: What action is this related to? (reading, shopping, visiting a place, booking, etc.)

Return a concise summary of what you found, optimized for search. Be specific with names, titles, and details.

Format your response as:
EXTRACTED TEXT: [all visible text]
IDENTIFIED: [what this is - e.g., "Book cover for 'Power and Progress' by Daron Acemoglu"]
SEARCH QUERY: [best search query to find more info about this]`
      }
    ];

    // Add images to content
    for (const url of imagesToAnalyze) {
      content.push({
        type: 'image_url',
        image_url: { url }
      });
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash', // Gemini has excellent vision capabilities
        messages: [
          {
            role: 'user',
            content
          }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Image Analysis] Failed:', errText);
      return '';
    }

    const data = await response.json();
    const analysisResult = data.choices?.[0]?.message?.content || '';
    console.log('[Image Analysis] Result:', analysisResult.substring(0, 200) + '...');
    
    return analysisResult;
  } catch (e) {
    console.error('[Image Analysis] Error:', e);
    return '';
  }
}

// Classify intent using Lovable AI
async function classifyIntent(
  noteTitle: string, 
  noteContent: string, 
  tags: string[],
  imageContext: string = ''
): Promise<{ category: IntentCategory; searchQuery: string; reasoning: string }> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const imageSection = imageContext 
    ? `\n\nIMAGE ANALYSIS (OCR/Vision extracted from attached images):\n${imageContext}`
    : '';

  const prompt = `Analyze this task/note and classify its intent for providing actionable help.

TASK TITLE: "${noteTitle}"
ORIGINAL CONTENT: "${noteContent}"
TAGS: ${tags.length > 0 ? tags.join(', ') : 'none'}${imageSection}

CLASSIFY INTO ONE OF THESE CATEGORIES:
1. BOOK_MEDIA - Books, movies, podcasts, music to read/watch/listen (tags like "book", "reading", "movie", "podcast")
2. LOCAL_PLACE - Restaurants, doctors, shops, services to visit (tags like "restaurant", "health", "shopping", "food")
3. NAVIGATIONAL - Websites, accounts, logins, sign-ups, bookings (tags like "account", "sign up", "login", "booking")
4. GENERAL_TASK - General tasks that need search for tips (pet sitter, travel, errands)

IMPORTANT: If image analysis contains specific product names, book titles, or business names, use those EXACT names in your search query for accuracy.

ALSO GENERATE:
- A specific search query to find actionable information (use exact names from images when available)
- Brief reasoning for your classification

Respond in JSON format only:
{
  "category": "BOOK_MEDIA" | "LOCAL_PLACE" | "NAVIGATIONAL" | "GENERAL_TASK",
  "searchQuery": "optimized search query with specific names from images",
  "reasoning": "brief explanation"
}`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an intent classifier. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Intent classification failed:', errText);
    throw new Error('Failed to classify intent');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON in response:', content);
    return { category: 'GENERAL_TASK', searchQuery: noteTitle, reasoning: 'Fallback' };
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Failed to parse intent JSON:', e);
    return { category: 'GENERAL_TASK', searchQuery: noteTitle, reasoning: 'Parse error fallback' };
  }
}

// Search web using Firecrawl
async function searchWithFirecrawl(query: string, limit: number = 5): Promise<any[]> {
  const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
  if (!FIRECRAWL_API_KEY) {
    console.log('FIRECRAWL_API_KEY not configured, skipping search');
    return [];
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    if (!response.ok) {
      console.error('Firecrawl search failed:', response.status);
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (e) {
    console.error('Firecrawl search error:', e);
    return [];
  }
}

// Generate structured tip using AI + search results
async function generateTip(
  category: IntentCategory,
  searchQuery: string,
  noteTitle: string,
  noteContent: string,
  tags: string[],
  imageContext: string = ''
): Promise<TipData> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  // Search for relevant information
  console.log(`Searching for: ${searchQuery}`);
  const searchResults = await searchWithFirecrawl(searchQuery, 5);
  
  // Format search results for AI
  const searchContext = searchResults.length > 0 
    ? searchResults.map((r, i) => `[${i+1}] ${r.title || 'No title'}\nURL: ${r.url}\n${r.description || r.markdown?.slice(0, 500) || 'No content'}`).join('\n\n')
    : 'No search results available. Generate helpful suggestions based on the task.';

  const imageSection = imageContext 
    ? `\n\nIMAGE CONTEXT (extracted from attached images):\n${imageContext}`
    : '';

  const prompt = `You are Olive, a helpful AI assistant. Based on the user's task and search results, generate actionable tips.

TASK: "${noteTitle}"
DETAILS: "${noteContent}"
TAGS: ${tags.join(', ') || 'none'}
CATEGORY: ${category}${imageSection}

SEARCH RESULTS:
${searchContext}

Generate a structured tip with:
1. A brief, helpful summary (1-2 sentences max)
2. 1-3 actionable buttons with REAL URLs from the search results
3. Relevant metadata (image, phone, address, rating, price, author) if available

CRITICAL RULES:
- Only include URLs that actually appear in the search results
- For BOOK_MEDIA: prioritize Amazon, Goodreads, or official sites
- For LOCAL_PLACE: include phone number and address if found
- For NAVIGATIONAL: find the exact login/signup/booking page
- For GENERAL_TASK: provide the most relevant help resources
- If image analysis identified specific products/books, use that info for metadata

Respond in JSON only:
{
  "title": "Short action title",
  "summary": "Brief helpful explanation",
  "actions": [
    { "label": "Action Label", "url": "https://...", "type": "primary", "icon": "shopping-cart|phone|map-pin|external-link|book|calendar" }
  ],
  "metadata": {
    "image": "url or null",
    "rating": 4.5,
    "phone": "+1-xxx-xxx-xxxx or null",
    "address": "full address or null",
    "price": "$XX.XX or null",
    "author": "name or null",
    "source": "source name"
  }
}`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that generates structured JSON tips. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Tip generation failed:', errText);
    throw new Error('Failed to generate tip');
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('No JSON in tip response:', content);
    throw new Error('Invalid tip response format');
  }

  const tipContent = JSON.parse(jsonMatch[0]);
  
  // Map category to type
  const typeMap: Record<IntentCategory, TipData['type']> = {
    'BOOK_MEDIA': 'book',
    'LOCAL_PLACE': 'place',
    'NAVIGATIONAL': 'action',
    'GENERAL_TASK': 'general',
  };

  return {
    status: 'generated',
    type: typeMap[category],
    generated_at: new Date().toISOString(),
    title: tipContent.title || noteTitle,
    summary: tipContent.summary || 'Here are some helpful suggestions.',
    actions: (tipContent.actions || []).filter((a: any) => a.url && a.url.startsWith('http')),
    metadata: tipContent.metadata || {},
  };
}

serve(async (req) => {
  console.log('[Generate Olive Tip] Request received:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { note_id } = await req.json();
    
    if (!note_id) {
      return new Response(
        JSON.stringify({ error: 'note_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Fetch the note including media_urls
    const { data: note, error: noteError } = await supabase
      .from('clerk_notes')
      .select('id, summary, original_text, tags, category, media_urls')
      .eq('id', note_id)
      .single();

    if (noteError || !note) {
      console.error('Note fetch error:', noteError);
      return new Response(
        JSON.stringify({ error: 'Note not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Generate Olive Tip] Processing note:', note.summary);
    console.log('[Generate Olive Tip] Media URLs:', note.media_urls?.length || 0, 'images');

    // Step 1: Analyze images if present (OCR/Vision)
    let imageContext = '';
    if (note.media_urls && note.media_urls.length > 0) {
      console.log('[Generate Olive Tip] Analyzing images with vision...');
      imageContext = await analyzeImages(note.media_urls);
    }

    // Step 2: Classify intent (now with image context)
    const { category, searchQuery, reasoning } = await classifyIntent(
      note.summary,
      note.original_text,
      note.tags || [],
      imageContext
    );
    console.log('[Generate Olive Tip] Intent:', category, 'Query:', searchQuery, 'Reason:', reasoning);

    // Step 3: Generate tip with search results (now with image context)
    const tip = await generateTip(
      category,
      searchQuery,
      note.summary,
      note.original_text,
      note.tags || [],
      imageContext
    );
    console.log('[Generate Olive Tip] Generated tip:', tip.title);

    // Step 4: Save to database
    const { error: updateError } = await supabase
      .from('clerk_notes')
      .update({ olive_tips: tip })
      .eq('id', note_id);

    if (updateError) {
      console.error('Failed to save tip:', updateError);
      // Still return the tip even if save fails
    }

    return new Response(
      JSON.stringify({ success: true, tip, imageAnalyzed: !!imageContext }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Generate Olive Tip] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
