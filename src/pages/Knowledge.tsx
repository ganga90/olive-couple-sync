import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Brain, Users, MapPin, Package, Building2, Calendar, Lightbulb, ArrowLeft, Search, RefreshCw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useKnowledgeGraph, type KnowledgeEntity } from "@/hooks/useKnowledgeGraph";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

const entityTypeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  person: { icon: <Users className="h-4 w-4" />, color: "bg-blue-100 text-blue-800", label: "People" },
  place: { icon: <MapPin className="h-4 w-4" />, color: "bg-green-100 text-green-800", label: "Places" },
  product: { icon: <Package className="h-4 w-4" />, color: "bg-orange-100 text-orange-800", label: "Products" },
  organization: { icon: <Building2 className="h-4 w-4" />, color: "bg-purple-100 text-purple-800", label: "Organizations" },
  date_event: { icon: <Calendar className="h-4 w-4" />, color: "bg-red-100 text-red-800", label: "Dates & Events" },
  concept: { icon: <Lightbulb className="h-4 w-4" />, color: "bg-yellow-100 text-yellow-800", label: "Concepts" },
  amount: { icon: <span className="text-sm font-bold">$</span>, color: "bg-emerald-100 text-emerald-800", label: "Amounts" },
};

function EntityCard({ entity, onClick }: { entity: KnowledgeEntity; onClick: () => void }) {
  const config = entityTypeConfig[entity.entity_type] || entityTypeConfig.concept;
  const metadata = entity.metadata || {};

  return (
    <button onClick={onClick} className="w-full text-left">
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Badge variant="outline" className={`${config.color} shrink-0`}>
                {config.icon}
              </Badge>
              <div className="min-w-0">
                <p className="font-medium truncate">{entity.name}</p>
                {metadata.relationship && (
                  <p className="text-xs text-muted-foreground">{metadata.relationship}</p>
                )}
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0 ml-2">
              {entity.mention_count}x
            </span>
          </div>
          {metadata.aliases?.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              aka: {metadata.aliases.slice(0, 3).join(", ")}
            </p>
          )}
        </CardContent>
      </Card>
    </button>
  );
}

function EntityDetail({
  entity,
  relationships,
  entities,
  onClose,
}: {
  entity: KnowledgeEntity;
  relationships: any[];
  entities: KnowledgeEntity[];
  onClose: () => void;
}) {
  const config = entityTypeConfig[entity.entity_type] || entityTypeConfig.concept;
  const metadata = entity.metadata || {};

  // Find relationships involving this entity
  const relatedRels = relationships.filter(
    (r) => r.source_entity_id === entity.id || r.target_entity_id === entity.id
  );

  const entityMap = new Map(entities.map((e) => [e.id, e]));

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className={config.color}>{config.icon}</Badge>
            <CardTitle className="text-lg">{entity.name}</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {config.label} &middot; Mentioned {entity.mention_count} times &middot; First seen{" "}
          {new Date(entity.first_seen).toLocaleDateString()}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metadata */}
        {Object.keys(metadata).filter((k) => k !== "aliases" && k !== "source").length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Details</h4>
            <div className="space-y-1">
              {Object.entries(metadata)
                .filter(([k]) => k !== "aliases" && k !== "source")
                .map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}:</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Aliases */}
        {metadata.aliases?.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Also known as</h4>
            <div className="flex flex-wrap gap-1">
              {metadata.aliases.map((alias: string, i: number) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {alias}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Relationships */}
        {relatedRels.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Connections ({relatedRels.length})</h4>
            <div className="space-y-2">
              {relatedRels.map((rel) => {
                const otherId =
                  rel.source_entity_id === entity.id ? rel.target_entity_id : rel.source_entity_id;
                const otherEntity = entityMap.get(otherId);
                const direction = rel.source_entity_id === entity.id ? "→" : "←";

                return (
                  <div key={rel.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                    <span>{direction}</span>
                    <Badge variant="outline" className="text-xs">
                      {rel.relationship_type}
                    </Badge>
                    <span className="font-medium">{otherEntity?.name || "Unknown"}</span>
                    <Badge
                      variant="outline"
                      className={`text-xs ml-auto ${
                        rel.confidence === "EXTRACTED"
                          ? "border-green-300 text-green-700"
                          : rel.confidence === "INFERRED"
                          ? "border-yellow-300 text-yellow-700"
                          : "border-red-300 text-red-700"
                      }`}
                    >
                      {rel.confidence}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Knowledge() {
  const { t } = useTranslation();
  const navigate = useLocalizedNavigate();
  const {
    isLoading,
    entities,
    relationships,
    communities,
    stats,
    refresh,
    activeFilter,
    filterByType,
  } = useKnowledgeGraph();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<KnowledgeEntity | null>(null);

  const filteredEntities = useMemo(() => {
    let result = entities;
    if (activeFilter) {
      result = result.filter((e) => e.entity_type === activeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.canonical_name.includes(q) ||
          e.metadata?.aliases?.some((a: string) => a.toLowerCase().includes(q))
      );
    }
    return result;
  }, [entities, activeFilter, searchQuery]);

  const entityTypes = useMemo(() => {
    const types = new Set(entities.map((e) => e.entity_type));
    return Array.from(types).sort();
  }, [entities]);

  return (
    <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" />
              Knowledge Graph
            </h1>
            <p className="text-sm text-muted-foreground">
              Entities and connections extracted from your notes
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.totalEntities}</p>
              <p className="text-xs text-muted-foreground">Entities</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.totalRelationships}</p>
              <p className="text-xs text-muted-foreground">Connections</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{Object.keys(stats.entityTypes).length}</p>
              <p className="text-xs text-muted-foreground">Entity Types</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.topEntities[0]?.mention_count || 0}</p>
              <p className="text-xs text-muted-foreground">Top Mentions</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Type filters */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeFilter === null ? "default" : "outline"}
          size="sm"
          onClick={() => filterByType(null)}
        >
          All ({entities.length})
        </Button>
        {entityTypes.map((type) => {
          const config = entityTypeConfig[type];
          const count = entities.filter((e) => e.entity_type === type).length;
          return (
            <Button
              key={type}
              variant={activeFilter === type ? "default" : "outline"}
              size="sm"
              onClick={() => filterByType(type)}
              className="gap-1"
            >
              {config?.icon}
              {config?.label || type} ({count})
            </Button>
          );
        })}
      </div>

      {/* Content */}
      <Tabs defaultValue="entities" className="w-full">
        <TabsList>
          <TabsTrigger value="entities">Entities</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="entities" className="space-y-4">
          {selectedEntity && (
            <EntityDetail
              entity={selectedEntity}
              relationships={relationships}
              entities={entities}
              onClose={() => setSelectedEntity(null)}
            />
          )}

          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
              Loading knowledge graph...
            </div>
          ) : filteredEntities.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-medium mb-2">Your knowledge graph is building</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  As you add notes, Olive automatically extracts people, places, and concepts,
                  building a connected graph of your knowledge. Keep adding notes to see it grow!
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredEntities.map((entity) => (
                  <EntityCard
                    key={entity.id}
                    entity={entity}
                    onClick={() => setSelectedEntity(entity)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="connections" className="space-y-4">
          {relationships.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No connections found yet. Connections are created when entities are mentioned
                  together in notes.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {relationships.map((rel) => {
                  const source = entities.find((e) => e.id === rel.source_entity_id);
                  const target = entities.find((e) => e.id === rel.target_entity_id);
                  if (!source || !target) return null;

                  return (
                    <Card key={rel.id}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <Badge variant="outline" className={entityTypeConfig[source.entity_type]?.color || ""}>
                          {source.name}
                        </Badge>
                        <div className="flex flex-col items-center text-xs text-muted-foreground">
                          <span>{rel.relationship_type}</span>
                          <span className="text-[10px]">→</span>
                        </div>
                        <Badge variant="outline" className={entityTypeConfig[target.entity_type]?.color || ""}>
                          {target.name}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={`ml-auto text-xs ${
                            rel.confidence === "EXTRACTED"
                              ? "border-green-300"
                              : rel.confidence === "INFERRED"
                              ? "border-yellow-300"
                              : "border-red-300"
                          }`}
                        >
                          {(rel.confidence_score * 100).toFixed(0)}%
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="insights" className="space-y-4">
          {stats && stats.topEntities.length > 0 ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Most Referenced Entities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {stats.topEntities.slice(0, 5).map((entity, i) => {
                      const config = entityTypeConfig[entity.entity_type];
                      const maxMentions = stats.topEntities[0].mention_count;
                      const width = Math.max(10, (entity.mention_count / maxMentions) * 100);

                      return (
                        <div key={entity.id} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground w-4">{i + 1}.</span>
                              {config?.icon}
                              <span className="font-medium">{entity.name}</span>
                            </div>
                            <span className="text-muted-foreground">{entity.mention_count}x</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full transition-all"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Entity Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.entityTypes)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => {
                        const config = entityTypeConfig[type];
                        return (
                          <Badge key={type} variant="outline" className={`${config?.color || ""} gap-1`}>
                            {config?.icon}
                            {config?.label || type}: {count}
                          </Badge>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Insights will appear as your knowledge graph grows.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
