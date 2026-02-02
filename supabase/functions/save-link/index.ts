/**
 * SAVE-LINK Edge Function
 * ============================================================================
 * Feature 2: Recall & Reframe Agent - Link Saving with RAG
 *
 * Flow: URL → Fetch Content → AI Summary → Generate Embedding → Store
 *
 * This function:
 * 1. Receives a URL to save
 * 2. Fetches and parses the webpage content
 * 3. Uses Gemini to generate a summary
 * 4. Generates an embedding for semantic search
 * 5. Stores the link with metadata in saved_links table
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface SaveLinkRequest {
  url: string;
  user_id: string;
  couple_id?: string;
  tags?: string[];
  notes?: string;
  source_note_id?: string;
}

interface PageContent {
  title: string;
  description: string;
  content: string;
  domain: string;
  image_url?: string;
  author?: string;
  publish_date?: string;
}

interface LinkSummary {
  summary: string;
  source_type: string;
  tags: string[];
  metadata: Record<string, any>;
}

// ============================================================================
// URL CONTENT FETCHING
// ============================================================================

async function fetchPageContent(url: string): Promise<PageContent> {
  console.log('[save-link] Fetching URL:', url);

  try {
    // Parse URL for domain
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');

    // Fetch with reasonable timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OliveBot/1.0; +https://witholive.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    console.log('[save-link] Fetched HTML length:', html.length);

    // Extract metadata using regex (simple approach that works without DOM)
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : urlObj.pathname;

    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
    const imageUrl = ogImageMatch ? ogImageMatch[1] : undefined;

    const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']*)["']/i);
    const author = authorMatch ? authorMatch[1].trim() : undefined;

    const dateMatch = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']*)["']/i);
    const publishDate = dateMatch ? dateMatch[1] : undefined;

    // Extract main content (simplified - remove scripts, styles, nav, footer)
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Limit content length
    content = content.substring(0, 10000);

    return {
      title,
      description,
      content,
      domain,
      image_url: imageUrl,
      author,
      publish_date: publishDate
    };

  } catch (error) {
    console.error('[save-link] Fetch error:', error);
    // Return minimal info from URL
    const urlObj = new URL(url);
    return {
      title: urlObj.pathname || url,
      description: '',
      content: '',
      domain: urlObj.hostname.replace('www.', ''),
    };
  }
}

// ============================================================================
// AI SUMMARIZATION
// ============================================================================

async function generateLinkSummary(
  genai: GoogleGenAI,
  pageContent: PageContent,
  url: string
): Promise<LinkSummary> {
  console.log('[save-link] Generating summary for:', pageContent.title);

  const prompt = `Analyze this webpage and provide a useful summary for future recall.

URL: ${url}
Domain: ${pageContent.domain}
Title: ${pageContent.title}
Description: ${pageContent.description}
Content Preview: ${pageContent.content.substring(0, 3000)}

Provide:
1. A concise summary (2-3 sentences) capturing the key information
2. Source type classification
3. Relevant tags (3-5 keywords)
4. Any useful metadata (prices, ratings, addresses, dates, etc.)

Source types:
- article: News, blog posts, written content
- product: E-commerce product pages
- recipe: Cooking recipes
- restaurant: Restaurant/cafe pages
- place: Locations, attractions, venues
- video: YouTube, Vimeo, etc.
- social: Social media posts
- document: PDFs, docs, resources
- link: General webpage (default)

Return JSON:
{
  "summary": "The key takeaways from this page...",
  "source_type": "article|product|recipe|restaurant|place|video|social|document|link",
  "tags": ["tag1", "tag2", "tag3"],
  "metadata": {
    "price": "$19.99",
    "rating": "4.5 stars",
    "address": "123 Main St...",
    "key_points": ["point 1", "point 2"]
  }
}`;

  try {
    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 500
      }
    });

    const responseText = response.text || '';
    console.log('[save-link] Gemini summary response:', responseText.substring(0, 200));

    const parsed = JSON.parse(responseText);

    return {
      summary: parsed.summary || pageContent.description || pageContent.title,
      source_type: parsed.source_type || 'link',
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      metadata: parsed.metadata || {}
    };

  } catch (error) {
    console.error('[save-link] Summary generation error:', error);
    // Return fallback summary
    return {
      summary: pageContent.description || `Saved from ${pageContent.domain}`,
      source_type: detectSourceType(url, pageContent.domain),
      tags: [],
      metadata: {}
    };
  }
}

// ============================================================================
// SOURCE TYPE DETECTION (FALLBACK)
// ============================================================================

function detectSourceType(url: string, domain: string): string {
  const domainLower = domain.toLowerCase();
  const urlLower = url.toLowerCase();

  // Recipe sites
  if (/allrecipes|epicurious|foodnetwork|tasty|bonappetit|seriouseats|simplyrecipes/i.test(domainLower)) {
    return 'recipe';
  }

  // Video sites
  if (/youtube|vimeo|tiktok|dailymotion/i.test(domainLower)) {
    return 'video';
  }

  // Social media
  if (/twitter|x\.com|instagram|facebook|reddit|linkedin/i.test(domainLower)) {
    return 'social';
  }

  // E-commerce
  if (/amazon|walmart|target|ebay|etsy|shopify|bestbuy|newegg/i.test(domainLower)) {
    return 'product';
  }

  // Restaurant/food
  if (/yelp|opentable|doordash|ubereats|grubhub|tripadvisor/i.test(domainLower)) {
    return 'restaurant';
  }

  // Travel/places
  if (/booking|airbnb|expedia|hotels|tripadvisor|maps\.google/i.test(domainLower)) {
    return 'place';
  }

  // Documents
  if (urlLower.endsWith('.pdf') || urlLower.includes('/doc')) {
    return 'document';
  }

  // News/articles (common patterns)
  if (/news|blog|article|post|story/i.test(urlLower)) {
    return 'article';
  }

  return 'link';
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

async function generateEmbedding(
  supabase: SupabaseClient,
  text: string
): Promise<number[] | null> {
  console.log('[save-link] Generating embedding for text length:', text.length);

  try {
    // Use the manage-memories function which has embedding generation
    const { data, error } = await supabase.functions.invoke('manage-memories', {
      body: {
        action: 'generate_embedding',
        text: text.substring(0, 8000)  // Limit text length
      }
    });

    if (error || !data?.embedding) {
      console.error('[save-link] Embedding generation failed:', error);
      return null;
    }

    console.log('[save-link] Embedding generated, dimensions:', data.embedding.length);
    return data.embedding;

  } catch (error) {
    console.error('[save-link] Embedding error:', error);
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API key is not configured');
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is missing');
    }

    const body: SaveLinkRequest = await req.json();
    const { url, user_id, couple_id, tags, notes, source_note_id } = body;

    // Validate required fields
    if (!user_id) {
      throw new Error('Missing required field: user_id');
    }

    if (!url) {
      throw new Error('Missing required field: url');
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }

    console.log('[save-link] Saving link for user:', user_id, 'URL:', url);

    // Initialize clients
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Check for duplicate URL
    const { data: existing } = await supabase
      .from('saved_links')
      .select('id, title')
      .eq('user_id', user_id)
      .eq('url', url)
      .single();

    if (existing) {
      console.log('[save-link] Link already saved:', existing.id);
      return new Response(JSON.stringify({
        success: true,
        duplicate: true,
        link: existing,
        message: 'This link was already saved'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Fetch page content
    const pageContent = await fetchPageContent(url);

    // Step 2: Generate AI summary
    const linkSummary = await generateLinkSummary(genai, pageContent, url);

    // Combine user tags with AI-generated tags
    const allTags = [...new Set([...(tags || []), ...linkSummary.tags])];

    // Step 3: Generate embedding for semantic search
    const embeddingText = [
      pageContent.title,
      linkSummary.summary,
      pageContent.description,
      allTags.join(' '),
      notes || ''
    ].filter(Boolean).join(' ');

    const embedding = await generateEmbedding(supabase, embeddingText);

    // Step 4: Save to database
    const linkData = {
      user_id,
      couple_id: couple_id || null,
      url,
      title: pageContent.title,
      description: pageContent.description,
      content_summary: linkSummary.summary,
      domain: pageContent.domain,
      source_type: linkSummary.source_type,
      tags: allTags,
      embedding,
      image_url: pageContent.image_url,
      source_note_id: source_note_id || null,
      fetched_at: new Date().toISOString(),
      metadata: {
        ...linkSummary.metadata,
        author: pageContent.author,
        publish_date: pageContent.publish_date,
        user_notes: notes
      }
    };

    const { data: savedLink, error: insertError } = await supabase
      .from('saved_links')
      .insert(linkData)
      .select()
      .single();

    if (insertError) {
      console.error('[save-link] Insert error:', insertError);
      throw new Error(`Failed to save link: ${insertError.message}`);
    }

    console.log('[save-link] Link saved successfully:', savedLink.id);

    return new Response(JSON.stringify({
      success: true,
      duplicate: false,
      link: {
        id: savedLink.id,
        url: savedLink.url,
        title: savedLink.title,
        summary: savedLink.content_summary,
        domain: savedLink.domain,
        source_type: savedLink.source_type,
        tags: savedLink.tags,
        image_url: savedLink.image_url
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[save-link] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Unknown error occurred'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
