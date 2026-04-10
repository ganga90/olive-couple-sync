/**
 * Knowledge Graph Hook
 *
 * Fetches entities, relationships, and communities from the knowledge graph.
 * Provides search, filtering, and graph data formatting for visualization.
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";

export interface KnowledgeEntity {
  id: string;
  name: string;
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, any>;
  mention_count: number;
  first_seen: string;
  last_seen: string;
}

export interface KnowledgeRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: string;
  confidence_score: number;
  rationale: string;
  source_note_id: string | null;
}

export interface KnowledgeCommunity {
  id: string;
  label: string;
  entity_ids: string[];
  cohesion: number;
}

// Graph visualization format
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  mentionCount: number;
  metadata: Record<string, any>;
  communityId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence: string;
  confidenceScore: number;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: KnowledgeCommunity[];
}

interface UseKnowledgeGraphReturn {
  isLoading: boolean;
  error: Error | null;
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  communities: KnowledgeCommunity[];
  graphData: KnowledgeGraphData | null;
  stats: {
    totalEntities: number;
    totalRelationships: number;
    totalCommunities: number;
    entityTypes: Record<string, number>;
    topEntities: KnowledgeEntity[];
  } | null;
  refresh: () => Promise<void>;
  searchEntities: (query: string) => Promise<KnowledgeEntity[]>;
  filterByType: (type: string | null) => void;
  activeFilter: string | null;
}

export function useKnowledgeGraph(): UseKnowledgeGraphReturn {
  const { user } = useAuth();
  const userId = user?.id;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [entities, setEntities] = useState<KnowledgeEntity[]>([]);
  const [relationships, setRelationships] = useState<KnowledgeRelationship[]>([]);
  const [communities, setCommunities] = useState<KnowledgeCommunity[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);

    try {
      const [entitiesRes, relationshipsRes, communitiesRes] = await Promise.all([
        supabase
          .from("olive_entities")
          .select("*")
          .eq("user_id", userId)
          .order("mention_count", { ascending: false })
          .limit(200),
        supabase
          .from("olive_relationships")
          .select("*")
          .eq("user_id", userId)
          .limit(500),
        supabase
          .from("olive_entity_communities")
          .select("*")
          .eq("user_id", userId),
      ]);

      if (entitiesRes.error) throw entitiesRes.error;
      if (relationshipsRes.error) throw relationshipsRes.error;
      // Communities table might not exist yet — handle gracefully

      setEntities(entitiesRes.data || []);
      setRelationships(relationshipsRes.data || []);
      setCommunities(communitiesRes.data || []);
    } catch (err) {
      // If tables don't exist yet, show empty state instead of error
      if (err instanceof Error && err.message?.includes("does not exist")) {
        setEntities([]);
        setRelationships([]);
        setCommunities([]);
      } else {
        setError(err instanceof Error ? err : new Error("Failed to fetch knowledge graph"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const searchEntities = useCallback(
    async (query: string): Promise<KnowledgeEntity[]> => {
      if (!userId || !query.trim()) return [];

      const { data } = await supabase
        .from("olive_entities")
        .select("*")
        .eq("user_id", userId)
        .ilike("name", `%${query}%`)
        .order("mention_count", { ascending: false })
        .limit(20);

      return data || [];
    },
    [userId]
  );

  const filterByType = useCallback((type: string | null) => {
    setActiveFilter(type);
  }, []);

  // Build graph visualization data
  const graphData: KnowledgeGraphData | null =
    entities.length > 0
      ? {
          nodes: entities
            .filter((e) => !activeFilter || e.entity_type === activeFilter)
            .map((e) => ({
              id: e.id,
              label: e.name,
              type: e.entity_type,
              mentionCount: e.mention_count,
              metadata: e.metadata,
              communityId: communities.find((c) => c.entity_ids?.includes(e.id))?.id,
            })),
          edges: relationships
            .filter((r) => {
              if (!activeFilter) return true;
              const filteredIds = new Set(
                entities.filter((e) => e.entity_type === activeFilter).map((e) => e.id)
              );
              return filteredIds.has(r.source_entity_id) || filteredIds.has(r.target_entity_id);
            })
            .map((r) => ({
              id: r.id,
              source: r.source_entity_id,
              target: r.target_entity_id,
              label: r.relationship_type,
              confidence: r.confidence,
              confidenceScore: r.confidence_score,
            })),
          communities,
        }
      : null;

  // Compute stats
  const stats =
    entities.length > 0
      ? {
          totalEntities: entities.length,
          totalRelationships: relationships.length,
          totalCommunities: communities.length,
          entityTypes: entities.reduce(
            (acc, e) => {
              acc[e.entity_type] = (acc[e.entity_type] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
          topEntities: entities.slice(0, 10),
        }
      : null;

  return {
    isLoading,
    error,
    entities,
    relationships,
    communities,
    graphData,
    stats,
    refresh: fetchData,
    searchEntities,
    filterByType,
    activeFilter,
  };
}
