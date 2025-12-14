import React, { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Calendar, User, Tag, List, Sparkles, Pencil, Check, X, Plus, Clock, AlertTriangle } from "lucide-react";
import { format, isPast, isToday } from "date-fns";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NoteRecapProps {
  note: {
    id?: string;
    summary: string;
    category: string;
    dueDate?: string | null;
    priority?: "low" | "medium" | "high";
    tags?: string[];
    items?: string[];
    originalText: string;
    author?: string;
    createdAt?: string;
    task_owner?: string | null;
    list_id?: string | null;
  };
  onClose?: () => void;
  onNoteUpdated?: (updatedNote: any) => void;
}

export const NoteRecap: React.FC<NoteRecapProps> = ({ note, onClose, onNoteUpdated }) => {
  const [isEditing, setIsEditing] = useState(false);
  
  const formatDateSafely = (dateValue: string | null | undefined): string => {
    if (!dateValue) return "";
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return "";
      return format(date, "yyyy-MM-dd");
    } catch {
      return "";
    }
  };
  
  const [editedNote, setEditedNote] = useState({
    summary: note.summary,
    category: note.category,
    priority: note.priority || "medium",
    tags: note.tags ? note.tags.join(", ") : "",
    items: note.items ? note.items.join("\n") : "",
    dueDate: formatDateSafely(note.dueDate),
    taskOwner: note.task_owner || "",
    listId: note.list_id || ""
  });
  const [newListName, setNewListName] = useState("");
  const [showNewListInput, setShowNewListInput] = useState(false);
  
  const { updateNote } = useSupabaseNotesContext();
  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  const { lists, createList, loading: listsLoading } = useSupabaseLists(currentCouple?.id || null);

  const availableOwners = useMemo(() => {
    const owners = [];
    if (user?.fullName) {
      owners.push({
        id: user.id,
        name: currentCouple?.you_name || user.fullName,
        isCurrentUser: true
      });
    }
    if (currentCouple?.partner_name) {
      owners.push({
        id: 'partner',
        name: currentCouple.partner_name,
        isCurrentUser: false
      });
    }
    return owners;
  }, [user, currentCouple]);

  const getPriorityConfig = (priority?: string) => {
    switch (priority) {
      case "high": return { 
        bg: "bg-priority-high/10", 
        text: "text-priority-high", 
        border: "border-priority-high/30",
        icon: AlertTriangle
      };
      case "medium": return { 
        bg: "bg-priority-medium/10", 
        text: "text-priority-medium", 
        border: "border-priority-medium/30",
        icon: Clock
      };
      case "low": return { 
        bg: "bg-priority-low/10", 
        text: "text-priority-low", 
        border: "border-priority-low/30",
        icon: CheckCircle
      };
      default: return { 
        bg: "bg-muted", 
        text: "text-muted-foreground", 
        border: "border-border",
        icon: CheckCircle
      };
    }
  };

  const getCategoryConfig = (category: string) => {
    const configs: Record<string, { bg: string; text: string; emoji: string }> = {
      groceries: { bg: "bg-success/10", text: "text-success", emoji: "🛒" },
      shopping: { bg: "bg-blue-500/10", text: "text-blue-600", emoji: "🛍️" },
      dateIdeas: { bg: "bg-pink-500/10", text: "text-pink-600", emoji: "💕" },
      homeImprovement: { bg: "bg-orange-500/10", text: "text-orange-600", emoji: "🏠" },
      travel: { bg: "bg-purple-500/10", text: "text-purple-600", emoji: "✈️" },
      reminder: { bg: "bg-amber-500/10", text: "text-amber-600", emoji: "⏰" },
      personal: { bg: "bg-indigo-500/10", text: "text-indigo-600", emoji: "📝" },
      task: { bg: "bg-primary/10", text: "text-primary", emoji: "✓" }
    };
    return configs[category] || { bg: "bg-muted", text: "text-muted-foreground", emoji: "📋" };
  };

  const deriveCategoryFromList = useCallback((listId: string) => {
    if (!listId) return editedNote.category;
    
    const selectedList = lists.find(list => list.id === listId);
    if (!selectedList) return editedNote.category;
    
    const listName = selectedList.name.toLowerCase();
    const categoryMap: { [key: string]: string } = {
      'groceries': 'groceries',
      'shopping': 'shopping',
      'date ideas': 'dateIdeas',
      'home improvement': 'homeImprovement',
      'travel': 'travel',
      'travel ideas': 'travel',
      'reminder': 'reminder',
      'personal': 'personal',
      'task': 'task',
      'tasks': 'task'
    };
    
    return categoryMap[listName] || 'task';
  }, [lists, editedNote.category]);

  const handleSaveEdit = async () => {
    if (!note.id) {
      toast.error("Cannot edit note - no ID found");
      return;
    }

    let finalListId = editedNote.listId;
    let finalCategory = editedNote.category;
    
    if (showNewListInput && newListName.trim()) {
      try {
        const newList = await createList({
          name: newListName.trim(),
          description: `Custom list for organizing notes`,
          is_manual: true
        });
        if (newList) {
          finalListId = newList.id;
          finalCategory = deriveCategoryFromList(newList.id);
          setShowNewListInput(false);
          setNewListName("");
          toast.success(`Created new list: ${newList.name}`);
        }
      } catch (error) {
        console.error("Error creating new list:", error);
        toast.error("Failed to create new list");
        return;
      }
    } else if (finalListId) {
      finalCategory = deriveCategoryFromList(finalListId);
    }

    try {
      const updates = {
        summary: editedNote.summary.trim(),
        category: finalCategory,
        priority: editedNote.priority,
        tags: editedNote.tags.split(",").map(tag => tag.trim()).filter(Boolean),
        items: editedNote.items.split("\n").map(item => item.trim()).filter(Boolean),
        due_date: editedNote.dueDate ? new Date(editedNote.dueDate).toISOString() : null,
        task_owner: editedNote.taskOwner.trim() || null,
        list_id: finalListId || null
      };

      const updatedNote = await updateNote(note.id, updates);
      if (updatedNote) {
        onNoteUpdated?.(updatedNote);
        setIsEditing(false);
        toast.success("Note updated successfully!");
      }
    } catch (error) {
      console.error("Error updating note:", error);
      toast.error("Failed to update note");
    }
  };

  const handleCancelEdit = () => {
    setEditedNote({
      summary: note.summary,
      category: note.category,
      priority: note.priority || "medium",
      tags: note.tags ? note.tags.join(", ") : "",
      items: note.items ? note.items.join("\n") : "",
      dueDate: formatDateSafely(note.dueDate),
      taskOwner: note.task_owner || "",
      listId: note.list_id || ""
    });
    setIsEditing(false);
    setShowNewListInput(false);
    setNewListName("");
  };

  const priorityConfig = getPriorityConfig(note.priority);
  const categoryConfig = getCategoryConfig(note.category);
  const PriorityIcon = priorityConfig.icon;

  // Check if due date is overdue or today
  const dueStatus = useMemo(() => {
    if (!note.dueDate) return null;
    try {
      const date = new Date(note.dueDate);
      if (isNaN(date.getTime())) return null;
      if (isToday(date)) return 'today';
      if (isPast(date)) return 'overdue';
      return 'upcoming';
    } catch {
      return null;
    }
  }, [note.dueDate]);

  return (
    <Card className={cn(
      "overflow-hidden border-border/50 bg-card/95 backdrop-blur-sm shadow-lg animate-scale-in",
      "transition-all duration-300"
    )}>
      {/* Priority indicator bar */}
      <div className={cn(
        "h-1.5 w-full",
        note.priority === "high" && "bg-priority-high",
        note.priority === "medium" && "bg-priority-medium",
        note.priority === "low" && "bg-priority-low",
        !note.priority && "bg-primary/50"
      )} />
      
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              "bg-success/10 text-success"
            )}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Note Organized!</h3>
              <p className="text-xs text-muted-foreground">AI processed your input</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            {!isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="h-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSaveEdit}
                  className="h-8 w-8 text-success hover:bg-success/10"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCancelEdit}
                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-2">
          {isEditing ? (
            <Textarea
              value={editedNote.summary}
              onChange={(e) => setEditedNote(prev => ({ ...prev, summary: e.target.value }))}
              className="text-base font-medium border-border focus:border-primary focus:ring-primary/20 resize-none"
              rows={2}
            />
          ) : (
            <p className="text-lg font-medium text-foreground leading-snug">{note.summary}</p>
          )}
        </div>

        {/* Badges row */}
        {!isEditing && (
          <div className="flex flex-wrap gap-2 animate-fade-in">
            <Badge className={cn(
              "text-xs font-medium border",
              categoryConfig.bg, categoryConfig.text, "border-current/20"
            )}>
              <span className="mr-1">{categoryConfig.emoji}</span>
              {note.category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
            </Badge>
            
            {note.priority && (
              <Badge className={cn(
                "text-xs font-medium border",
                priorityConfig.bg, priorityConfig.text, priorityConfig.border
              )}>
                <PriorityIcon className="w-3 h-3 mr-1" />
                {note.priority.charAt(0).toUpperCase() + note.priority.slice(1)}
              </Badge>
            )}
            
            {dueStatus === 'overdue' && (
              <Badge className="bg-destructive/10 text-destructive border border-destructive/20 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Overdue
              </Badge>
            )}
            
            {dueStatus === 'today' && (
              <Badge className="bg-primary/10 text-primary border border-primary/20 text-xs">
                <Clock className="w-3 h-3 mr-1" />
                Due Today
              </Badge>
            )}
          </div>
        )}

        {/* Edit form fields */}
        {isEditing && (
          <div className="space-y-3 pt-2 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select value={editedNote.priority} onValueChange={(value) => setEditedNote(prev => ({ ...prev, priority: value as "low" | "medium" | "high" }))}>
                  <SelectTrigger className="h-9 text-sm border-border focus:border-primary">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">🟢 Low</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="high">🔴 High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Due Date</label>
                <Input
                  type="date"
                  value={editedNote.dueDate}
                  onChange={(e) => setEditedNote(prev => ({ ...prev, dueDate: e.target.value }))}
                  className="h-9 text-sm border-border focus:border-primary"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Task Owner</label>
                <Select
                  value={editedNote.taskOwner || "none"}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, taskOwner: value === "none" ? "" : value }))}
                >
                  <SelectTrigger className="h-9 text-sm border-border focus:border-primary">
                    <SelectValue placeholder="Select owner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No owner</SelectItem>
                    {availableOwners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.name}>
                        {owner.name} {owner.isCurrentUser ? "(You)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">List</label>
                <Select
                  value={showNewListInput ? "new" : (editedNote.listId || "none")}
                  onValueChange={(value) => {
                    if (value === "new") {
                      setShowNewListInput(true);
                      setEditedNote(prev => ({ ...prev, listId: "" }));
                    } else {
                      setShowNewListInput(false);
                      setEditedNote(prev => ({ ...prev, listId: value === "none" ? "" : value }));
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-sm border-border focus:border-primary">
                    <SelectValue placeholder="Select list..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No list</SelectItem>
                    {lists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="new">
                      <div className="flex items-center gap-1.5">
                        <Plus className="h-3.5 w-3.5" />
                        New list...
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {showNewListInput && (
              <div className="flex gap-2 animate-fade-in">
                <Input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="New list name..."
                  className="h-9 text-sm border-border focus:border-primary"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newListName.trim()) {
                      handleSaveEdit();
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowNewListInput(false);
                    setNewListName("");
                  }}
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Items list */}
        {(isEditing || (note.items && note.items.length > 0)) && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</h4>
            </div>
            {isEditing ? (
              <Textarea
                value={editedNote.items}
                onChange={(e) => setEditedNote(prev => ({ ...prev, items: e.target.value }))}
                placeholder="Enter items, one per line..."
                className="text-sm border-border focus:border-primary resize-none"
                rows={3}
              />
            ) : (
              <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                {note.items?.slice(0, 4).map((item, index) => (
                  <div 
                    key={index} 
                    className="text-sm text-foreground flex items-center gap-2"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
                {note.items && note.items.length > 4 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    +{note.items.length - 4} more items
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {(isEditing || (note.tags && note.tags.length > 0)) && (
          <div className="space-y-2 animate-fade-in">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tags</h4>
            </div>
            {isEditing ? (
              <Input
                value={editedNote.tags}
                onChange={(e) => setEditedNote(prev => ({ ...prev, tags: e.target.value }))}
                placeholder="Enter tags separated by commas..."
                className="h-9 text-sm border-border focus:border-primary"
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {note.tags?.map((tag, index) => (
                  <Badge 
                    key={index} 
                    variant="outline" 
                    className="text-xs bg-background hover:bg-muted transition-colors"
                  >
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metadata footer */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-3 border-t border-border/50">
          {note.author && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              <span>{note.author}</span>
            </div>
          )}
          {note.task_owner && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-primary" />
              <span className="text-primary">{note.task_owner}</span>
            </div>
          )}
          {note.createdAt && (() => {
            try {
              const date = new Date(note.createdAt);
              return !isNaN(date.getTime()) ? (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{format(date, "MMM d, h:mm a")}</span>
                </div>
              ) : null;
            } catch {
              return null;
            }
          })()}
          {note.dueDate && (() => {
            try {
              const date = new Date(note.dueDate);
              return !isNaN(date.getTime()) ? (
                <div className={cn(
                  "flex items-center gap-1.5",
                  dueStatus === 'overdue' && "text-destructive",
                  dueStatus === 'today' && "text-primary"
                )}>
                  <Clock className="h-3.5 w-3.5" />
                  <span>Due {format(date, "MMM d")}</span>
                </div>
              ) : null;
            } catch {
              return null;
            }
          })()}
        </div>

        {/* Original text reference */}
        <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/30">
          <span className="font-medium">Original:</span> "{note.originalText.length > 150 ? note.originalText.slice(0, 150) + '...' : note.originalText}"
        </div>
      </div>
    </Card>
  );
};