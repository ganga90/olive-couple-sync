import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDays, User, MessageCircle, CheckCircle2, Circle } from "lucide-react";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import type { Note } from "@/types/note";
import { format } from "date-fns";

interface NoteCardProps {
  note: Note;
  onToggleComplete?: (id: string, completed: boolean) => void;
  onAskOlive?: (note: Note) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({ 
  note, 
  onToggleComplete, 
  onAskOlive 
}) => {
  const { you, partner } = useSupabaseCouple();
  const { updateNote } = useSupabaseNotesContext();
  
  const isYourNote = note.addedBy === "you" || you === note.addedBy;
  const authorName = isYourNote ? "You" : partner || "Partner";
  
  const handleToggleComplete = async () => {
    const newCompleted = !note.completed;
    await updateNote(note.id, { completed: newCompleted });
    onToggleComplete?.(note.id, newCompleted);
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "high": return "bg-destructive/10 text-destructive border-destructive/20";
      case "medium": return "bg-olive/10 text-olive border-olive/20";
      case "low": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <Card className={`p-4 transition-all duration-200 hover:shadow-soft ${
      note.completed ? "opacity-75 bg-muted/30" : "bg-card"
    }`}>
      <div className="space-y-3">
        {/* Header with completion toggle */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleComplete}
              className="p-0 h-auto hover:bg-transparent"
            >
              {note.completed ? (
                <CheckCircle2 className="h-5 w-5 text-olive" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground hover:text-olive" />
              )}
            </Button>
            <h3 className={`font-medium text-sm leading-relaxed ${
              note.completed ? "line-through text-muted-foreground" : "text-foreground"
            }`}>
              {note.summary}
            </h3>
          </div>
          
          {note.priority && (
            <Badge variant="outline" className={`text-xs ${getPriorityColor(note.priority)}`}>
              {note.priority}
            </Badge>
          )}
        </div>

        {/* Tags */}
        {note.tags && note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {note.tags.map((tag, index) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Items list */}
        {note.items && note.items.length > 0 && (
          <div className="space-y-1">
            {note.items.slice(0, 3).map((item, index) => (
              <div key={index} className="text-sm text-muted-foreground">
                • {item}
              </div>
            ))}
            {note.items.length > 3 && (
              <div className="text-xs text-muted-foreground">
                +{note.items.length - 3} more items
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {authorName}
            </div>
            
            {note.dueDate && (
              <div className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {format(new Date(note.dueDate), "MMM d")}
              </div>
            )}
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAskOlive?.(note)}
            className="text-xs h-auto py-1 px-2 text-olive hover:text-olive-dark hover:bg-olive/10"
          >
            <MessageCircle className="h-3 w-3 mr-1" />
            Ask Olive
          </Button>
        </div>
      </div>
    </Card>
  );
};