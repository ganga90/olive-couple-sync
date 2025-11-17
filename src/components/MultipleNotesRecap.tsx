import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkles, Edit, ChevronDown, ChevronUp } from "lucide-react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { toast } from "sonner";
import { NoteRecap } from "./NoteRecap";

interface MultipleNotesRecapProps {
  notes: Array<{
    summary: string;
    category: string;
    dueDate?: string | null;
    priority?: "low" | "medium" | "high";
    tags?: string[];
    items?: string[];
    originalText: string;
    task_owner?: string | null;
    list_id?: string | null;
  }>;
  originalText: string;
  onClose?: () => void;
  onNotesAdded?: () => void;
}

export const MultipleNotesRecap: React.FC<MultipleNotesRecapProps> = ({ 
  notes, 
  originalText, 
  onClose, 
  onNotesAdded 
}) => {
  const [savedNotes, setSavedNotes] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [editingNote, setEditingNote] = useState<number | null>(null);
  
  const { addNote, refetch: refetchNotes } = useSupabaseNotesContext();
  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "high": return "bg-red-100 text-red-800 border-red-200";
      case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "low": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "groceries": return "bg-green-100 text-green-800 border-green-200";
      case "shopping": return "bg-blue-100 text-blue-800 border-blue-200";
      case "date_ideas": return "bg-pink-100 text-pink-800 border-pink-200";
      case "home_improvement": return "bg-orange-100 text-orange-800 border-orange-200";
      case "travel": return "bg-purple-100 text-purple-800 border-purple-200";
      case "reminder": return "bg-amber-100 text-amber-800 border-amber-200";
      case "personal": return "bg-indigo-100 text-indigo-800 border-indigo-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const handleSaveAllNotes = async () => {
    if (!user) {
      toast.error("Please sign in to save notes");
      return;
    }

    setIsSaving(true);
    const newSavedNotes = [];

    try {
      for (const note of notes) {
        const noteData = {
          originalText: note.originalText || originalText,
          summary: note.summary,
          category: note.category,
          dueDate: note.dueDate,
          completed: false,
          priority: note.priority,
          tags: note.tags,
          items: note.items,
          list_id: note.list_id,
          task_owner: note.task_owner,
        };

        const savedNote = await addNote(noteData);
        if (savedNote) {
          newSavedNotes.push({
            ...savedNote,
            summary: note.summary,
            category: note.category,
            dueDate: note.dueDate,
            priority: note.priority,
            tags: note.tags,
            items: note.items,
            originalText: note.originalText || originalText,
            author: user.firstName || user.fullName || "You",
            createdAt: savedNote.createdAt,
            task_owner: note.task_owner,
            list_id: note.list_id
          });
        }
      }

      setSavedNotes(newSavedNotes);
      await refetchNotes();
      onNotesAdded?.();
      toast.success(`Successfully created ${newSavedNotes.length} notes!`);
    } catch (error) {
      console.error("Error saving notes:", error);
      toast.error("Failed to save some notes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedNotes);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedNotes(newExpanded);
  };

  const handleEditNote = (index: number) => {
    setEditingNote(index);
  };

  const handleNoteUpdated = (updatedNote: any) => {
    setSavedNotes(prev => prev.map((note, i) => 
      editingNote === i ? { ...note, ...updatedNote } : note
    ));
    setEditingNote(null);
    onNotesAdded?.();
  };

  // Show individual note editor if editing
  if (editingNote !== null && savedNotes[editingNote]) {
    return (
      <NoteRecap
        note={savedNotes[editingNote]}
        onClose={() => setEditingNote(null)}
        onNoteUpdated={handleNoteUpdated}
      />
    );
  }

  return (
    <Card className="bg-gradient-to-br from-olive/5 to-olive/10 border-olive/20 shadow-soft">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-olive" />
            <h3 className="text-lg font-semibold text-foreground">
              {savedNotes.length > 0 ? `${savedNotes.length} Notes Created!` : `${notes.length} Notes Organized!`}
            </h3>
          </div>
          <Sparkles className="h-5 w-5 text-olive animate-pulse" />
        </div>

        {/* Original text */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Original Note</h4>
          <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 italic">
            "{originalText}"
          </p>
        </div>

        {/* Summary of notes */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            AI Split Into {notes.length} Tasks
          </h4>
          <div className="grid gap-3">
            {notes.map((note, index) => (
              <Card key={index} className="border-olive/10 bg-white/50">
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h5 className="font-medium text-foreground">{note.summary}</h5>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge className={getCategoryColor(note.category)}>
                          {note.category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </Badge>
                        {note.priority && (
                          <Badge className={getPriorityColor(note.priority)}>
                            {note.priority} priority
                          </Badge>
                        )}
                        {note.task_owner && (
                          <Badge variant="outline">
                            Owner: {note.task_owner}
                          </Badge>
                        )}
                        {note.dueDate && (
                          <Badge variant="outline">
                            Due: {(() => {
                              try {
                                const date = new Date(note.dueDate);
                                return isNaN(date.getTime()) ? "Invalid Date" : date.toLocaleDateString();
                              } catch {
                                return "Invalid Date";
                              }
                            })()}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {savedNotes.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditNote(index)}
                          className="text-olive hover:bg-olive/10"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpanded(index)}
                        className="text-muted-foreground hover:bg-muted/20"
                      >
                        {expandedNotes.has(index) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedNotes.has(index) && (
                    <div className="mt-4 pt-4 border-t border-olive/10 space-y-3">
                      {note.items && note.items.length > 0 && (
                        <div>
                          <h6 className="text-sm font-medium text-muted-foreground mb-2">Items:</h6>
                          <ul className="space-y-1">
                            {note.items.map((item, itemIndex) => (
                              <li key={itemIndex} className="text-sm text-foreground flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-olive rounded-full"></span>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {note.tags && note.tags.length > 0 && (
                        <div>
                          <h6 className="text-sm font-medium text-muted-foreground mb-2">Tags:</h6>
                          <div className="flex flex-wrap gap-1">
                            {note.tags.map((tag, tagIndex) => (
                              <Badge key={tagIndex} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-3 pt-4 border-t border-olive/20">
          {savedNotes.length === 0 ? (
            <Button 
              onClick={handleSaveAllNotes}
              disabled={isSaving}
              className="w-full bg-olive hover:bg-olive/90 text-white"
            >
              {isSaving ? (
                <>
                  <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                  Saving {notes.length} Notes...
                </>
              ) : (
                `Save All ${notes.length} Notes`
              )}
            </Button>
          ) : (
            <>
              <Button 
                onClick={onClose}
                className="w-full bg-olive hover:bg-olive/90 text-white"
              >
                Continue & Add More Notes
              </Button>
              <Button 
                onClick={onClose}
                variant="outline" 
                className="w-full border-olive/30 text-olive hover:bg-olive/10"
              >
                Done
              </Button>
            </>
          )}
        </div>
      </div>  
    </Card>
  );
};