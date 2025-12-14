import React, { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkles, Edit, ChevronDown, ChevronUp, AlertTriangle, Clock, User, Calendar, Tag, List } from "lucide-react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { toast } from "sonner";
import { NoteRecap } from "./NoteRecap";
import { cn } from "@/lib/utils";
import { isPast, isToday } from "date-fns";

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

  const getPriorityConfig = (priority?: string) => {
    switch (priority) {
      case "high": return { 
        bg: "bg-priority-high/10", 
        text: "text-priority-high", 
        border: "border-priority-high/30",
        bar: "bg-priority-high",
        icon: AlertTriangle
      };
      case "medium": return { 
        bg: "bg-priority-medium/10", 
        text: "text-priority-medium", 
        border: "border-priority-medium/30",
        bar: "bg-priority-medium",
        icon: Clock
      };
      case "low": return { 
        bg: "bg-priority-low/10", 
        text: "text-priority-low", 
        border: "border-priority-low/30",
        bar: "bg-priority-low",
        icon: CheckCircle
      };
      default: return { 
        bg: "bg-muted", 
        text: "text-muted-foreground", 
        border: "border-border",
        bar: "bg-primary/50",
        icon: CheckCircle
      };
    }
  };

  const getCategoryConfig = (category: string) => {
    const configs: Record<string, { bg: string; text: string; emoji: string }> = {
      groceries: { bg: "bg-success/10", text: "text-success", emoji: "🛒" },
      shopping: { bg: "bg-blue-500/10", text: "text-blue-600", emoji: "🛍️" },
      date_ideas: { bg: "bg-pink-500/10", text: "text-pink-600", emoji: "💕" },
      dateIdeas: { bg: "bg-pink-500/10", text: "text-pink-600", emoji: "💕" },
      home_improvement: { bg: "bg-orange-500/10", text: "text-orange-600", emoji: "🏠" },
      homeImprovement: { bg: "bg-orange-500/10", text: "text-orange-600", emoji: "🏠" },
      travel: { bg: "bg-purple-500/10", text: "text-purple-600", emoji: "✈️" },
      reminder: { bg: "bg-amber-500/10", text: "text-amber-600", emoji: "⏰" },
      personal: { bg: "bg-indigo-500/10", text: "text-indigo-600", emoji: "📝" },
      task: { bg: "bg-primary/10", text: "text-primary", emoji: "✓" }
    };
    return configs[category] || { bg: "bg-muted", text: "text-muted-foreground", emoji: "📋" };
  };

  const getDueStatus = (dueDate?: string | null) => {
    if (!dueDate) return null;
    try {
      const date = new Date(dueDate);
      if (isNaN(date.getTime())) return null;
      if (isToday(date)) return 'today';
      if (isPast(date)) return 'overdue';
      return 'upcoming';
    } catch {
      return null;
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
    <Card className={cn(
      "overflow-hidden border-border/50 bg-card/95 backdrop-blur-sm shadow-lg animate-scale-in",
      "transition-all duration-300"
    )}>
      {/* Success indicator bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-success to-primary" />
      
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              "bg-success/10 text-success"
            )}>
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {savedNotes.length > 0 ? `${savedNotes.length} Notes Created!` : `${notes.length} Notes Organized!`}
              </h3>
              <p className="text-xs text-muted-foreground">AI split your brain-dump into tasks</p>
            </div>
          </div>
          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
            <List className="w-3 h-3 mr-1" />
            {notes.length} tasks
          </Badge>
        </div>

        {/* Original text */}
        <div className="space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px]">📝</span>
            Original Note
          </div>
          <div className="bg-muted/30 rounded-lg p-3 border border-border/30">
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              "{originalText}"
            </p>
          </div>
        </div>

        {/* Notes grid */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span className="w-4 h-4 rounded-full bg-success/20 flex items-center justify-center text-[10px]">✨</span>
            Split Into {notes.length} Tasks
          </div>
          
          <div className="grid gap-2">
            {notes.map((note, index) => {
              const priorityConfig = getPriorityConfig(note.priority);
              const categoryConfig = getCategoryConfig(note.category);
              const dueStatus = getDueStatus(note.dueDate);
              const PriorityIcon = priorityConfig.icon;
              
              return (
                <Card 
                  key={index} 
                  className={cn(
                    "overflow-hidden border-border/30 bg-background/50 transition-all duration-200",
                    "hover:border-border/50 hover:shadow-sm",
                    expandedNotes.has(index) && "border-primary/20 shadow-sm"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* Priority indicator bar */}
                  <div className={cn("h-1 w-full", priorityConfig.bar)} />
                  
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h5 className="font-medium text-sm text-foreground truncate">{note.summary}</h5>
                        
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <Badge className={cn(
                            "text-[10px] font-medium border h-5",
                            categoryConfig.bg, categoryConfig.text, "border-current/20"
                          )}>
                            <span className="mr-0.5">{categoryConfig.emoji}</span>
                            {note.category.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                          </Badge>
                          
                          {note.priority && (
                            <Badge className={cn(
                              "text-[10px] font-medium border h-5",
                              priorityConfig.bg, priorityConfig.text, priorityConfig.border
                            )}>
                              <PriorityIcon className="w-2.5 h-2.5 mr-0.5" />
                              {note.priority}
                            </Badge>
                          )}
                          
                          {note.task_owner && (
                            <Badge variant="outline" className="text-[10px] h-5 border-border/50">
                              <User className="w-2.5 h-2.5 mr-0.5" />
                              {note.task_owner}
                            </Badge>
                          )}
                          
                          {dueStatus === 'overdue' && (
                            <Badge className="bg-destructive/10 text-destructive border border-destructive/20 text-[10px] h-5">
                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                              Overdue
                            </Badge>
                          )}
                          
                          {dueStatus === 'today' && (
                            <Badge className="bg-primary/10 text-primary border border-primary/20 text-[10px] h-5">
                              <Clock className="w-2.5 h-2.5 mr-0.5" />
                              Today
                            </Badge>
                          )}
                          
                          {note.dueDate && dueStatus === 'upcoming' && (
                            <Badge variant="outline" className="text-[10px] h-5 border-border/50">
                              <Calendar className="w-2.5 h-2.5 mr-0.5" />
                              {(() => {
                                try {
                                  const date = new Date(note.dueDate);
                                  return isNaN(date.getTime()) ? "Invalid" : date.toLocaleDateString();
                                } catch {
                                  return "Invalid";
                                }
                              })()}
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1 shrink-0">
                        {savedNotes.length > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditNote(index)}
                            className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleExpanded(index)}
                          className={cn(
                            "h-7 w-7 transition-colors",
                            expandedNotes.has(index) 
                              ? "text-primary bg-primary/10" 
                              : "text-muted-foreground hover:bg-muted/50"
                          )}
                        >
                          {expandedNotes.has(index) ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedNotes.has(index) && (
                      <div className="mt-3 pt-3 border-t border-border/30 space-y-3 animate-fade-in">
                        {note.items && note.items.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                              <List className="w-3 h-3" />
                              Items ({note.items.length})
                            </div>
                            <ul className="space-y-1.5 pl-1">
                              {note.items.map((item, itemIndex) => (
                                <li 
                                  key={itemIndex} 
                                  className="text-xs text-foreground flex items-start gap-2 animate-fade-in"
                                  style={{ animationDelay: `${itemIndex * 30}ms` }}
                                >
                                  <span className={cn(
                                    "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                                    priorityConfig.bar
                                  )} />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {note.tags && note.tags.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                              <Tag className="w-3 h-3" />
                              Tags
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {note.tags.map((tag, tagIndex) => (
                                <Badge 
                                  key={tagIndex} 
                                  variant="outline" 
                                  className="text-[10px] h-5 bg-muted/30 border-border/50"
                                >
                                  #{tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2 pt-3 border-t border-border/30">
          {savedNotes.length === 0 ? (
            <Button 
              onClick={handleSaveAllNotes}
              disabled={isSaving}
              variant="accent"
              className="w-full h-11 font-medium"
            >
              {isSaving ? (
                <>
                  <Sparkles className="h-4 w-4 mr-2 animate-spin" />
                  Saving {notes.length} Notes...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Save All {notes.length} Notes
                </>
              )}
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button 
                onClick={onClose}
                variant="accent"
                className="flex-1 h-10 font-medium"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Add More Notes
              </Button>
              <Button 
                onClick={onClose}
                variant="outline" 
                className="h-10 px-6 border-border/50 hover:bg-muted/50"
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </div>  
    </Card>
  );
};
