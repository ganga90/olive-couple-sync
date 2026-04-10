/**
 * Olive Knowledge Extract
 *
 * Two-pass entity and relationship extraction pipeline inspired by Graphify.
 *
 * Pass 1 (Deterministic): Regex/heuristic extraction of people, places, dates, amounts, URLs
 * Pass 2 (LLM):          Gemini Flash-Lite infers relationships, confidence scores, and
 *                         entities that require context to identify.
 *
 * After extraction, entities are resolved against existing ones (deduplication)
 * and persisted to olive_entities + olive_relationships.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// TYPES
// ============================================================================

interface ExtractedEntity {
  name: string;
  entity_type: "person" | "place" | "product" | "organization" | "date_event" | "amount" | "concept";
  confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
  confidence_score: number;
  metadata: Record<string, any>;
}

interface ExtractedRelationship {
  source_name: string;
  target_name: string;
  relationship_type: string;
  confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
  confidence_score: number;
  rationale: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

// ============================================================================
// PASS 1: DETERMINISTIC EXTRACTION
// ============================================================================

function deterministicExtract(text: string, summary: string, items: string[], tags: string[]): ExtractionResult {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const combined = `${text}\n${summary}\n${items.join('\n')}`;
  const seen = new Set<string>();

  function addEntity(e: ExtractedEntity) {
    const key = `${e.entity_type}:${e.name.toLowerCase().trim()}`;
    if (!seen.has(key) && e.name.trim().length > 1) {
      seen.add(key);
      entities.push(e);
    }
  }

  // --- Monetary amounts ---
  const amountRegex = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/g;
  let match;
  while ((match = amountRegex.exec(combined)) !== null) {
    addEntity({
      name: match[0],
      entity_type: "amount",
      confidence: "EXTRACTED",
      confidence_score: 1.0,
      metadata: { value: parseFloat(match[1].replace(/,/g, "")), currency: "USD" },
    });
  }

  // --- URLs ---
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  while ((match = urlRegex.exec(combined)) !== null) {
    // Extract domain as an organization entity
    try {
      const url = new URL(match[0]);
      const domain = url.hostname.replace(/^www\./, "");
      addEntity({
        name: domain,
        entity_type: "organization",
        confidence: "EXTRACTED",
        confidence_score: 0.9,
        metadata: { url: match[0], source: "url_extraction" },
      });
    } catch { /* invalid URL */ }
  }

  // --- Phone numbers ---
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
  while ((match = phoneRegex.exec(combined)) !== null) {
    if (match[0].replace(/\D/g, "").length >= 7) {
      addEntity({
        name: match[0].trim(),
        entity_type: "concept",
        confidence: "EXTRACTED",
        confidence_score: 1.0,
        metadata: { type: "phone_number" },
      });
    }
  }

  // --- Dates (specific dates like "March 15", "Jan 3rd", "2026-04-10") ---
  const datePatterns = [
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
  ];
  for (const pattern of datePatterns) {
    while ((match = pattern.exec(combined)) !== null) {
      addEntity({
        name: match[0].trim(),
        entity_type: "date_event",
        confidence: "EXTRACTED",
        confidence_score: 1.0,
        metadata: { raw_date: match[0] },
      });
    }
  }

  // --- Items as potential entities (products, places from structured data) ---
  for (const item of items) {
    const itemStr = typeof item === 'string' ? item : String(item);
    // "Website: url" → already captured
    // "Venue: X" or "Restaurant: X" → place
    const venueMatch = itemStr.match(/^(?:Venue|Restaurant|Location|Address|Place|Store|Clinic|Hospital):\s*(.+)/i);
    if (venueMatch) {
      addEntity({
        name: venueMatch[1].trim(),
        entity_type: "place",
        confidence: "EXTRACTED",
        confidence_score: 0.95,
        metadata: { source: "item_extraction" },
      });
    }

    // "Provider: Dr. X" or "Doctor: X" → person
    const personMatch = itemStr.match(/^(?:Provider|Doctor|Contact|Instructor|Trainer|Agent):\s*(.+)/i);
    if (personMatch) {
      addEntity({
        name: personMatch[1].trim(),
        entity_type: "person",
        confidence: "EXTRACTED",
        confidence_score: 0.95,
        metadata: { source: "item_extraction" },
      });
    }

    // "Brand: X" or "Product: X" → product
    const productMatch = itemStr.match(/^(?:Brand|Product|Model|Item|Code):\s*(.+)/i);
    if (productMatch) {
      addEntity({
        name: productMatch[1].trim(),
        entity_type: "product",
        confidence: "EXTRACTED",
        confidence_score: 0.9,
        metadata: { source: "item_extraction" },
      });
    }
  }

  return { entities, relationships };
}

// ============================================================================
// PASS 2: LLM EXTRACTION (Gemini Flash-Lite for cost efficiency)
// ============================================================================

async function llmExtract(
  text: string,
  summary: string,
  category: string,
  deterministicEntities: ExtractedEntity[],
): Promise<ExtractionResult> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    console.warn("[knowledge-extract] No Gemini API key, skipping LLM pass");
    return { entities: [], relationships: [] };
  }

  const existingEntitiesCtx = deterministicEntities.length > 0
    ? `\nAlready extracted entities (do NOT repeat these):\n${deterministicEntities.map(e => `- ${e.name} (${e.entity_type})`).join('\n')}`
    : '';

  const prompt = `You are an entity and relationship extraction engine for a personal knowledge graph.
Analyze this note and extract entities (people, places, products, organizations, concepts) and relationships between them.

Note text: "${text}"
${summary ? `Summary: "${summary}"` : ''}
Category: ${category || 'unknown'}
${existingEntitiesCtx}

Rules:
- Only extract entities that are SPECIFIC and NAMED (not generic words like "grocery store")
- For people: include relationship context if mentioned (e.g., "partner", "mom", "coworker")
- For relationships: describe WHY you inferred the connection
- Confidence levels:
  - EXTRACTED (1.0): explicitly stated in text
  - INFERRED (0.5-0.8): derived from context
  - AMBIGUOUS (≤0.4): uncertain, needs confirmation

Return JSON with this exact structure:
{
  "entities": [
    {
      "name": "entity name",
      "entity_type": "person|place|product|organization|date_event|concept",
      "confidence": "EXTRACTED|INFERRED|AMBIGUOUS",
      "confidence_score": 0.0-1.0,
      "metadata": {"key": "value"}
    }
  ],
  "relationships": [
    {
      "source_name": "entity A",
      "target_name": "entity B",
      "relationship_type": "knows|lives_at|works_at|prefers|owns|scheduled_for|costs|related_to|assigned_to|part_of|visited|wants",
      "confidence": "EXTRACTED|INFERRED|AMBIGUOUS",
      "confidence_score": 0.0-1.0,
      "rationale": "why this relationship exists"
    }
  ]
}

If no meaningful entities or relationships found, return {"entities":[],"relationships":[]}.
Return ONLY valid JSON, no markdown fences.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error("[knowledge-extract] Gemini error:", response.status);
      return { entities: [], relationships: [] };
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    // Parse JSON — handle potential markdown fences
    const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
    };
  } catch (error) {
    console.error("[knowledge-extract] LLM extraction error:", error);
    return { entities: [], relationships: [] };
  }
}

// ============================================================================
// ENTITY RESOLUTION: Deduplicate against existing entities
// ============================================================================

async function resolveEntity(
  supabase: any,
  entity: ExtractedEntity,
  userId: string,
  coupleId: string | null,
): Promise<{ entityId: string; isNew: boolean }> {
  const canonicalName = entity.name.toLowerCase().trim();

  // 1. Exact match on canonical_name
  const { data: exactMatch } = await supabase
    .from("olive_entities")
    .select("id, mention_count, metadata")
    .eq("user_id", userId)
    .eq("canonical_name", canonicalName)
    .maybeSingle();

  if (exactMatch) {
    // Update existing: increment mention count, merge metadata
    const mergedMetadata = { ...exactMatch.metadata, ...entity.metadata };
    // Track name aliases
    const aliases: string[] = mergedMetadata.aliases || [];
    if (!aliases.includes(entity.name) && entity.name !== canonicalName) {
      aliases.push(entity.name);
      mergedMetadata.aliases = aliases;
    }

    await supabase
      .from("olive_entities")
      .update({
        mention_count: (exactMatch.mention_count || 1) + 1,
        metadata: mergedMetadata,
        last_seen: new Date().toISOString(),
      })
      .eq("id", exactMatch.id);

    return { entityId: exactMatch.id, isNew: false };
  }

  // 2. Fuzzy match: check for similar names (simple Levenshtein-like via trigram)
  //    We check if any existing entity has a similar canonical name
  const { data: candidates } = await supabase
    .from("olive_entities")
    .select("id, canonical_name, name, mention_count, metadata, entity_type")
    .eq("user_id", userId)
    .eq("entity_type", entity.entity_type);

  if (candidates?.length) {
    for (const candidate of candidates) {
      // Check if the new name is an alias of existing
      const existingAliases: string[] = candidate.metadata?.aliases || [];
      const allNames = [candidate.canonical_name, candidate.name.toLowerCase(), ...existingAliases.map((a: string) => a.toLowerCase())];

      if (allNames.includes(canonicalName)) {
        // Match found via alias
        await supabase
          .from("olive_entities")
          .update({
            mention_count: (candidate.mention_count || 1) + 1,
            last_seen: new Date().toISOString(),
          })
          .eq("id", candidate.id);
        return { entityId: candidate.id, isNew: false };
      }

      // Simple substring match for short names (e.g., "Mom" matching "Maria (Mom)")
      if (
        canonicalName.length >= 3 &&
        (candidate.canonical_name.includes(canonicalName) || canonicalName.includes(candidate.canonical_name))
      ) {
        // Potential match — merge
        const mergedMetadata = { ...candidate.metadata, ...entity.metadata };
        const aliases: string[] = mergedMetadata.aliases || [];
        if (!aliases.includes(entity.name)) aliases.push(entity.name);
        mergedMetadata.aliases = aliases;

        await supabase
          .from("olive_entities")
          .update({
            mention_count: (candidate.mention_count || 1) + 1,
            metadata: mergedMetadata,
            last_seen: new Date().toISOString(),
          })
          .eq("id", candidate.id);

        return { entityId: candidate.id, isNew: false };
      }
    }
  }

  // 3. No match — create new entity
  const { data: newEntity, error } = await supabase
    .from("olive_entities")
    .insert({
      user_id: userId,
      couple_id: coupleId,
      name: entity.name,
      canonical_name: canonicalName,
      entity_type: entity.entity_type,
      metadata: entity.metadata,
      mention_count: 1,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[knowledge-extract] Entity insert error:", error);
    throw error;
  }

  // Generate embedding for future resolution (non-blocking)
  generateAndStoreEmbedding(supabase, newEntity.id, entity.name).catch((e) =>
    console.warn("[knowledge-extract] Embedding error:", e)
  );

  return { entityId: newEntity.id, isNew: true };
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

async function generateAndStoreEmbedding(supabase: any, entityId: string, text: string) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!GEMINI_API_KEY) return;

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

    if (response.ok) {
      const data = await response.json();
      const embedding = data.embedding?.values;
      if (embedding) {
        await supabase
          .from("olive_entities")
          .update({ embedding })
          .eq("id", entityId);
      }
    }
  } catch (e) {
    console.error("[knowledge-extract] Embedding generation failed:", e);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      user_id,
      couple_id,
      original_text,
      summary,
      category,
      items = [],
      tags = [],
      note_id,
    } = body;

    if (!user_id || !original_text) {
      throw new Error("Missing required fields: user_id and original_text");
    }

    // Normalize items to strings
    const itemStrings: string[] = items.map((i: any) =>
      typeof i === "string" ? i : i?.text || i?.content || JSON.stringify(i)
    );

    console.log(`[knowledge-extract] Processing note for user ${user_id}, text length: ${original_text.length}`);

    // ====================================================================
    // PASS 1: Deterministic extraction
    // ====================================================================
    const pass1 = deterministicExtract(original_text, summary || "", itemStrings, tags);
    console.log(`[knowledge-extract] Pass 1: ${pass1.entities.length} entities`);

    // ====================================================================
    // PASS 2: LLM extraction (only if text is substantial enough)
    // ====================================================================
    let pass2: ExtractionResult = { entities: [], relationships: [] };
    if (original_text.length >= 15) {
      pass2 = await llmExtract(original_text, summary || "", category || "", pass1.entities);
      console.log(`[knowledge-extract] Pass 2: ${pass2.entities.length} entities, ${pass2.relationships.length} relationships`);
    }

    // ====================================================================
    // MERGE: Combine both passes, deduplicate
    // ====================================================================
    const allEntities = [...pass1.entities, ...pass2.entities];
    const allRelationships = [...pass1.relationships, ...pass2.relationships];

    // Deduplicate entities by name+type
    const entityMap = new Map<string, ExtractedEntity>();
    for (const entity of allEntities) {
      const key = `${entity.entity_type}:${entity.name.toLowerCase().trim()}`;
      const existing = entityMap.get(key);
      if (!existing || entity.confidence_score > existing.confidence_score) {
        entityMap.set(key, entity);
      }
    }
    const uniqueEntities = Array.from(entityMap.values());

    // ====================================================================
    // RESOLVE & PERSIST: Match against existing entities, then store
    // ====================================================================
    const entityIdMap = new Map<string, string>(); // name → entity ID
    let entitiesCreated = 0;
    let entitiesUpdated = 0;

    for (const entity of uniqueEntities) {
      try {
        const { entityId, isNew } = await resolveEntity(supabase, entity, user_id, couple_id);
        entityIdMap.set(entity.name.toLowerCase().trim(), entityId);
        if (isNew) entitiesCreated++;
        else entitiesUpdated++;
      } catch (e) {
        console.warn(`[knowledge-extract] Failed to resolve entity "${entity.name}":`, e);
      }
    }

    // Persist relationships
    let relationshipsCreated = 0;
    for (const rel of allRelationships) {
      const sourceId = entityIdMap.get(rel.source_name.toLowerCase().trim());
      const targetId = entityIdMap.get(rel.target_name.toLowerCase().trim());

      if (!sourceId || !targetId || sourceId === targetId) continue;

      // Check for duplicate relationship
      const { data: existing } = await supabase
        .from("olive_relationships")
        .select("id")
        .eq("source_entity_id", sourceId)
        .eq("target_entity_id", targetId)
        .eq("relationship_type", rel.relationship_type)
        .maybeSingle();

      if (existing) {
        // Update confidence if new evidence
        await supabase
          .from("olive_relationships")
          .update({
            confidence: rel.confidence,
            confidence_score: Math.max(rel.confidence_score, 0.5),
            rationale: rel.rationale,
          })
          .eq("id", existing.id);
        continue;
      }

      const { error } = await supabase.from("olive_relationships").insert({
        user_id,
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relationship_type: rel.relationship_type,
        confidence: rel.confidence,
        confidence_score: rel.confidence_score,
        rationale: rel.rationale,
        source_note_id: note_id || null,
      });

      if (!error) relationshipsCreated++;
      else console.warn("[knowledge-extract] Relationship insert error:", error);
    }

    console.log(
      `[knowledge-extract] Done: ${entitiesCreated} new entities, ${entitiesUpdated} updated, ${relationshipsCreated} relationships`
    );

    return new Response(
      JSON.stringify({
        success: true,
        entities_count: uniqueEntities.length,
        entities_created: entitiesCreated,
        entities_updated: entitiesUpdated,
        relationships_count: relationshipsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[knowledge-extract] Error:", error);
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
