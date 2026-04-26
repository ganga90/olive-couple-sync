import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { useAuth } from "@/providers/AuthProvider";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ListIcon, CheckSquare, Brain, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabaseClient";

interface MemorySearchResult {
  id: string;
  content: string;
  snippet?: string;
  score: number;
  metadata: Record<string, any>;
}

export const UniversalSearch: React.FC = () => {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  const { lists } = useSupabaseLists(currentCouple?.id || null, currentSpace?.id || null);
  const [searchQuery, setSearchQuery] = useState("");
  const [memoryResults, setMemoryResults] = useState<MemorySearchResult[]>([]);
  const [memorySearching, setMemorySearching] = useState(false);
  const navigate = useLocalizedNavigate();
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local search for notes and lists
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return { notes: [], lists: [] };
    }

    const query = searchQuery.toLowerCase();

    const matchingNotes = notes.filter(note => 
      !note.completed && (
        note.summary.toLowerCase().includes(query) ||
        note.originalText.toLowerCase().includes(query) ||
        note.category.toLowerCase().includes(query) ||
        note.tags?.some(tag => tag.toLowerCase().includes(query))
      )
    ).slice(0, 5);

    const matchingLists = lists.filter(list =>
      list.name.toLowerCase().includes(query) ||
      list.description?.toLowerCase().includes(query)
    ).slice(0, 5);

    return { notes: matchingNotes, lists: matchingLists };
  }, [searchQuery, notes, lists]);

  // Semantic memory search (debounced)
  const searchMemories = useCallback(async (query: string) => {
    if (!user?.id || query.trim().length < 3) {
      setMemoryResults([]);
      return;
    }

    try {
      setMemorySearching(true);
      const { data, error } = await supabase.functions.invoke('olive-search', {
        body: {
          action: 'search_memory',
          user_id: user.id,
          query: query.trim(),
          limit: 5,
        }
      });

      if (!error && data?.success) {
        setMemoryResults(data.results || []);
      } else {
        setMemoryResults([]);
      }
    } catch {
      setMemoryResults([]);
    } finally {
      setMemorySearching(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchQuery.trim().length >= 3) {
      debounceRef.current = setTimeout(() => searchMemories(searchQuery), 400);
    } else {
      setMemoryResults([]);
    }

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, searchMemories]);

  const hasResults = searchResults.notes.length > 0 || searchResults.lists.length > 0 || memoryResults.length > 0;

  return (
    <Card className="bg-card/50 border-border/50 shadow-sm">
      <CardContent className="p-4 space-y-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-primary/60" />
          {memorySearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />
          )}
          <Input
            type="text"
            placeholder={t("search.placeholder", "Search tasks, lists & memories...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 pr-9 h-12 text-base border-border/50 focus:border-primary focus:ring-primary/20"
          />
        </div>

        {/* Search Results */}
        {searchQuery.trim() && (
          <div className="space-y-3">
            {/* Lists Results */}
            {searchResults.lists.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ListIcon className="h-4 w-4" />
                  <span>{t("search.lists", "Lists")}</span>
                </div>
                {searchResults.lists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => navigate(`/lists/${list.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-border/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="font-medium text-sm text-foreground">{list.name}</div>
                    {list.description && (
                      <div className="text-xs text-muted-foreground mt-1">{list.description}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Notes/Tasks Results */}
            {searchResults.notes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckSquare className="h-4 w-4" />
                  <span>{t("search.tasks", "Tasks")}</span>
                </div>
                {searchResults.notes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => navigate(`/note/${note.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-border/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="font-medium text-sm text-foreground mb-1">{note.summary}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {note.category}
                      </Badge>
                      {note.priority && (
                        <Badge variant="outline" className="text-xs">
                          {note.priority}
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Memory Results */}
            {memoryResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Brain className="h-4 w-4 text-primary" />
                  <span>{t("search.memories", "Memories")}</span>
                  <Sparkles className="h-3 w-3 text-primary/60" />
                </div>
                {memoryResults.map(memory => (
                  <button
                    key={memory.id}
                    onClick={() => navigate('/profile')}
                    className="w-full text-left p-3 rounded-lg border border-primary/10 bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    <div className="text-sm text-foreground leading-relaxed">
                      {memory.snippet || memory.content?.substring(0, 120)}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {memory.metadata?.chunk_type && (
                        <Badge variant="secondary" className="text-xs">
                          {memory.metadata.chunk_type}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {Math.round(memory.score * 100)}% {t("search.match", "match")}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No Results */}
            {!hasResults && !memorySearching && (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">{t("search.noResults", 'No results found for "{{query}}"', { query: searchQuery })}</p>
              </div>
            )}
          </div>
        )}

        {/* Initial State */}
        {!searchQuery.trim() && (
          <div className="text-center py-2 text-muted-foreground">
            <p className="text-sm">{t("search.hint", "Type to search your tasks, lists & memories")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
