/**
 * Olive Community Detection
 * ==========================
 * Clusters entities into "life domains" (communities) based on relationship density.
 * Inspired by Graphify's Leiden clustering approach, simplified for our use case.
 *
 * Communities represent emergent themes like "Health & Fitness", "Work", "Home",
 * "Social Life", etc. — derived from how entities are connected, NOT from manual categories.
 *
 * Runs:
 *   - On-demand via API (after knowledge extraction)
 *   - Periodically via olive-heartbeat (weekly)
 *
 * Algorithm:
 *   1. Build adjacency graph from olive_relationships
 *   2. Use greedy modularity optimization (simplified Leiden)
 *   3. Label communities using entity types and relationship context
 *   4. Persist to olive_entity_communities
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// GRAPH TYPES
// ============================================================================

interface GraphNode {
  id: string;
  name: string;
  entityType: string;
  mentionCount: number;
  community: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
}

// ============================================================================
// SIMPLIFIED LEIDEN / LOUVAIN COMMUNITY DETECTION
// ============================================================================

function detectCommunities(
  nodes: GraphNode[],
  edges: GraphEdge[],
  minCommunitySize = 2,
): Map<number, string[]> {
  if (nodes.length === 0) return new Map();

  // Build adjacency list with weights
  const adj = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    adj.set(node.id, new Map());
  }
  for (const edge of edges) {
    const w = edge.weight;
    if (adj.has(edge.source) && adj.has(edge.target)) {
      const srcMap = adj.get(edge.source)!;
      const tgtMap = adj.get(edge.target)!;
      srcMap.set(edge.target, (srcMap.get(edge.target) || 0) + w);
      tgtMap.set(edge.source, (tgtMap.get(edge.source) || 0) + w);
    }
  }

  // Total edge weight
  const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0) || 1;

  // Initialize: each node in its own community
  const communityOf = new Map<string, number>();
  let nextCommunity = 0;
  for (const node of nodes) {
    communityOf.set(node.id, nextCommunity++);
  }

  // Node degree (sum of edge weights)
  const degree = new Map<string, number>();
  for (const node of nodes) {
    let d = 0;
    const neighbors = adj.get(node.id);
    if (neighbors) {
      for (const w of neighbors.values()) d += w;
    }
    degree.set(node.id, d);
  }

  // Greedy modularity optimization (Louvain Phase 1)
  let improved = true;
  let iterations = 0;
  const maxIterations = 20;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (const node of nodes) {
      const nodeId = node.id;
      const currentCom = communityOf.get(nodeId)!;
      const neighbors = adj.get(nodeId) || new Map();
      const ki = degree.get(nodeId) || 0;

      // Calculate modularity gain for moving to each neighbor's community
      const communityWeights = new Map<number, number>();
      for (const [neighborId, weight] of neighbors) {
        const neighborCom = communityOf.get(neighborId)!;
        communityWeights.set(
          neighborCom,
          (communityWeights.get(neighborCom) || 0) + weight,
        );
      }

      let bestCom = currentCom;
      let bestGain = 0;

      for (const [com, kiin] of communityWeights) {
        if (com === currentCom) continue;

        // Sum of degrees in target community
        let sumTot = 0;
        for (const [nid, c] of communityOf) {
          if (c === com) sumTot += degree.get(nid) || 0;
        }

        // Modularity gain formula
        const gain = kiin / totalWeight - (sumTot * ki) / (2 * totalWeight * totalWeight);
        if (gain > bestGain) {
          bestGain = gain;
          bestCom = com;
        }
      }

      if (bestCom !== currentCom) {
        communityOf.set(nodeId, bestCom);
        improved = true;
      }
    }
  }

  // Collect communities
  const communities = new Map<number, string[]>();
  for (const [nodeId, com] of communityOf) {
    if (!communities.has(com)) communities.set(com, []);
    communities.get(com)!.push(nodeId);
  }

  // Filter out tiny communities
  const filtered = new Map<number, string[]>();
  let idx = 0;
  for (const [, members] of communities) {
    if (members.length >= minCommunitySize) {
      filtered.set(idx++, members);
    }
  }

  return filtered;
}

// ============================================================================
// COMMUNITY LABELING (LLM-free heuristic)
// ============================================================================

function labelCommunity(
  memberIds: string[],
  nodeMap: Map<string, GraphNode>,
  edges: GraphEdge[],
): { label: string; cohesion: number } {
  const members = memberIds.map((id) => nodeMap.get(id)).filter(Boolean) as GraphNode[];

  // Count entity types
  const typeCounts = new Map<string, number>();
  for (const m of members) {
    typeCounts.set(m.entityType, (typeCounts.get(m.entityType) || 0) + 1);
  }

  // Count relationship types within community
  const relTypes = new Map<string, number>();
  const memberSet = new Set(memberIds);
  let internalEdges = 0;
  let totalWeight = 0;

  for (const edge of edges) {
    if (memberSet.has(edge.source) && memberSet.has(edge.target)) {
      internalEdges++;
      totalWeight += edge.weight;
      relTypes.set(edge.type, (relTypes.get(edge.type) || 0) + 1);
    }
  }

  // Cohesion = internal edges / possible edges
  const possibleEdges = (members.length * (members.length - 1)) / 2 || 1;
  const cohesion = Math.min(internalEdges / possibleEdges, 1.0);

  // Generate label based on dominant entity types and relationships
  const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "concept";
  const dominantRel = [...relTypes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // Heuristic labeling
  const topNames = members
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 3)
    .map((m) => m.name);

  const labelMap: Record<string, string> = {
    person: "Social Circle",
    place: "Places & Locations",
    product: "Products & Purchases",
    organization: "Services & Organizations",
    amount: "Financial",
    date_event: "Schedule & Events",
    concept: "General",
  };

  let label = labelMap[dominantType] || "General";

  // Refine with relationship context
  if (dominantRel === "works_at" || dominantRel === "assigned_to") label = "Work & Career";
  if (dominantRel === "lives_at" || dominantRel === "part_of") label = "Home & Household";
  if (dominantRel === "prefers" || dominantRel === "wants") label = "Preferences & Wishlist";
  if (dominantRel === "costs" || dominantRel === "owns") label = "Purchases & Finance";
  if (dominantRel === "scheduled_for") label = "Schedule & Events";
  if (dominantRel === "visited") label = "Places & Travel";

  // Append top entity names for specificity
  if (topNames.length > 0) {
    label += ` (${topNames.join(", ")})`;
  }

  return { label, cohesion: Math.round(cohesion * 100) / 100 };
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
    const { user_id, couple_id } = body;

    if (!user_id) {
      throw new Error("Missing required field: user_id");
    }

    console.log(`[community-detect] Starting for user ${user_id}`);

    // 1. Fetch all entities for this user
    const { data: entities, error: entErr } = await supabase
      .from("olive_entities")
      .select("id, name, canonical_name, entity_type, mention_count")
      .eq("user_id", user_id);

    if (entErr) throw entErr;
    if (!entities?.length || entities.length < 3) {
      return new Response(
        JSON.stringify({ success: true, message: "Not enough entities for clustering", communities: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Fetch all relationships
    const { data: relationships, error: relErr } = await supabase
      .from("olive_relationships")
      .select("source_entity_id, target_entity_id, relationship_type, confidence_score")
      .eq("user_id", user_id);

    if (relErr) throw relErr;

    // 3. Build graph
    const nodes: GraphNode[] = entities.map((e: any) => ({
      id: e.id,
      name: e.name,
      entityType: e.entity_type,
      mentionCount: e.mention_count || 1,
      community: -1,
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const edges: GraphEdge[] = (relationships || [])
      .filter((r: any) => nodeMap.has(r.source_entity_id) && nodeMap.has(r.target_entity_id))
      .map((r: any) => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        weight: r.confidence_score || 0.5,
        type: r.relationship_type,
      }));

    if (edges.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No relationships for clustering", communities: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4. Detect communities
    const communities = detectCommunities(nodes, edges);
    console.log(`[community-detect] Found ${communities.size} communities from ${nodes.length} entities, ${edges.length} edges`);

    // 5. Clear old communities for this user
    await supabase
      .from("olive_entity_communities")
      .delete()
      .eq("user_id", user_id);

    // 6. Persist new communities
    let created = 0;
    for (const [, memberIds] of communities) {
      const { label, cohesion } = labelCommunity(memberIds, nodeMap, edges);

      const { error: insertErr } = await supabase
        .from("olive_entity_communities")
        .insert({
          user_id,
          entity_ids: memberIds,
          label,
          cohesion,
          metadata: {
            member_count: memberIds.length,
            member_names: memberIds.map((id) => nodeMap.get(id)?.name).filter(Boolean).slice(0, 10),
          },
        });

      if (!insertErr) created++;
      else console.warn("[community-detect] Insert error:", insertErr);
    }

    console.log(`[community-detect] Created ${created} communities`);

    return new Response(
      JSON.stringify({
        success: true,
        communities: created,
        total_entities: entities.length,
        total_relationships: relationships?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[community-detect] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
