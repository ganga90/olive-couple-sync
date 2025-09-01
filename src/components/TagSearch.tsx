import React, { useState, useMemo } from "react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Tag } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const TagSearch: React.FC = () => {
  const { notes } = useSupabaseNotesContext();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  // Get all unique tags from notes
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    notes.forEach(note => {
      note.tags?.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet);
  }, [notes]);

  // Filter tags based on search query
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return allTags;
    return allTags.filter(tag => 
      tag.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allTags, searchQuery]);

  // Get notes that have a specific tag
  const getNotesWithTag = (tag: string) => {
    return notes.filter(note => note.tags?.includes(tag));
  };

  const handleTagClick = (tag: string) => {
    // Navigate to notes page with tag filter (you can implement this route)
    const notesWithTag = getNotesWithTag(tag);
    if (notesWithTag.length === 1) {
      navigate(`/note/${notesWithTag[0].id}`);
    } else {
      // For multiple notes, you could navigate to a filtered view
      // For now, we'll just show all notes
      navigate('/lists');
    }
  };

  return (
    <Card className="bg-white/50 border-olive/20 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-olive-dark">
          <Search className="h-5 w-5 text-olive" />
          Search Tags
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 border-olive/30 focus:border-olive focus:ring-olive/20"
          />
        </div>
        
        {filteredTags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filteredTags.map(tag => {
              const noteCount = getNotesWithTag(tag).length;
              return (
                <button
                  key={tag}
                  onClick={() => handleTagClick(tag)}
                  className="flex items-center gap-1 hover:scale-105 transition-transform"
                >
                  <Badge 
                    variant="outline" 
                    className="bg-olive/10 border-olive/20 text-olive-dark hover:bg-olive/20 cursor-pointer"
                  >
                    <Tag className="h-3 w-3 mr-1" />
                    {tag}
                    <span className="ml-1 text-xs text-muted-foreground">({noteCount})</span>
                  </Badge>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">
              {searchQuery ? `No tags found for "${searchQuery}"` : "No tags available yet"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};