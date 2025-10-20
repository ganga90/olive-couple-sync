import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ListIcon, CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const UniversalSearch: React.FC = () => {
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists } = useSupabaseLists(currentCouple?.id || null);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  // Search both notes and lists
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return { notes: [], lists: [] };
    }

    const query = searchQuery.toLowerCase();

    // Search notes by summary, originalText, category, and tags
    const matchingNotes = notes.filter(note => 
      !note.completed && (
        note.summary.toLowerCase().includes(query) ||
        note.originalText.toLowerCase().includes(query) ||
        note.category.toLowerCase().includes(query) ||
        note.tags?.some(tag => tag.toLowerCase().includes(query))
      )
    ).slice(0, 5); // Limit to 5 results

    // Search lists by name and description
    const matchingLists = lists.filter(list =>
      list.name.toLowerCase().includes(query) ||
      list.description?.toLowerCase().includes(query)
    ).slice(0, 5); // Limit to 5 results

    return { notes: matchingNotes, lists: matchingLists };
  }, [searchQuery, notes, lists]);

  const hasResults = searchResults.notes.length > 0 || searchResults.lists.length > 0;

  return (
    <Card className="bg-white/50 border-olive/20 shadow-soft">
      <CardContent className="p-4 space-y-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tasks and lists..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 border-olive/30 focus:border-olive focus:ring-olive/20"
          />
        </div>

        {/* Search Results */}
        {searchQuery.trim() && (
          <div className="space-y-3">
            {/* Lists Results */}
            {searchResults.lists.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-olive-dark">
                  <ListIcon className="h-4 w-4" />
                  <span>Lists</span>
                </div>
                {searchResults.lists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => navigate(`/lists/${list.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-olive/10 hover:bg-olive/5 transition-colors"
                  >
                    <div className="font-medium text-sm text-olive-dark">{list.name}</div>
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
                <div className="flex items-center gap-2 text-sm font-medium text-olive-dark">
                  <CheckSquare className="h-4 w-4" />
                  <span>Tasks</span>
                </div>
                {searchResults.notes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => navigate(`/note/${note.id}`)}
                    className="w-full text-left p-3 rounded-lg border border-olive/10 hover:bg-olive/5 transition-colors"
                  >
                    <div className="font-medium text-sm text-olive-dark mb-1">{note.summary}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20 text-xs">
                        {note.category}
                      </Badge>
                      {note.priority && (
                        <Badge variant="secondary" className={`text-xs ${
                          note.priority === 'high' ? 'bg-red-100 text-red-800' :
                          note.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {note.priority}
                        </Badge>
                      )}
                      {note.tags && note.tags.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {note.tags.slice(0, 2).join(', ')}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No Results */}
            {!hasResults && (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">No tasks or lists found for "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}

        {/* Initial State */}
        {!searchQuery.trim() && (
          <div className="text-center py-2 text-muted-foreground">
            <p className="text-sm">Type to search your tasks and lists</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
