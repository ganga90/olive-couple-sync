import React, { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, Calendar, User, Tag, List, Sparkles, Pencil, Check, X, Plus } from "lucide-react";
import { format } from "date-fns";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { toast } from "sonner";

// Helper to safely format dates
const safeFormatDate = (dateValue: any, formatString: string): string => {
  if (!dateValue) return "";
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return "";
    return format(date, formatString);
  } catch {
    return "";
  }
};

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
    author: string;
    createdAt: string;
    task_owner?: string | null;
    list_id?: string | null;
  };
  onClose?: () => void;
  onNoteUpdated?: (updatedNote: any) => void;
}

export const NoteRecap: React.FC<NoteRecapProps> = ({ note, onClose, onNoteUpdated }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedNote, setEditedNote] = useState({
    summary: note.summary,
    category: note.category,
    priority: note.priority || "medium",
    tags: note.tags ? note.tags.join(", ") : "",
    items: note.items ? note.items.join("\n") : "",
    dueDate: safeFormatDate(note.dueDate, "yyyy-MM-dd"),
    taskOwner: note.task_owner || "",
    listId: note.list_id || ""
  });
  const [newListName, setNewListName] = useState("");
  const [showNewListInput, setShowNewListInput] = useState(false);
  
  const { updateNote } = useSupabaseNotesContext();
  const { user } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  const { lists, createList, loading: listsLoading } = useSupabaseLists(currentCouple?.id || null);

  // Get available owners (current user and partner) - same logic as NoteDetails
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
      case "dateIdeas": return "bg-pink-100 text-pink-800 border-pink-200";
      case "homeImprovement": return "bg-orange-100 text-orange-800 border-orange-200";
      case "travel": return "bg-purple-100 text-purple-800 border-purple-200";
      case "reminder": return "bg-amber-100 text-amber-800 border-amber-200";
      case "personal": return "bg-indigo-100 text-indigo-800 border-indigo-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Helper function to derive category from list
  const deriveCategoryFromList = useCallback((listId: string) => {
    if (!listId) return editedNote.category;
    
    const selectedList = lists.find(list => list.id === listId);
    if (!selectedList) return editedNote.category;
    
    // Convert list name back to category format
    const listName = selectedList.name.toLowerCase();
    
    // Map common list names to categories
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

    // Handle new list creation if needed
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
      // Derive category from selected list
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
      dueDate: safeFormatDate(note.dueDate, "yyyy-MM-dd"),
      taskOwner: note.task_owner || "",
      listId: note.list_id || ""
    });
    setIsEditing(false);
    setShowNewListInput(false);
    setNewListName("");
  };

  return (
    <Card className="bg-gradient-to-br from-olive/5 to-olive/10 border-olive/20 shadow-soft">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-olive" />
            <h3 className="text-lg font-semibold text-foreground">Note Organized!</h3>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="text-olive hover:bg-olive/10"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSaveEdit}
                  className="text-green-600 hover:bg-green-50"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="text-red-600 hover:bg-red-50"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <Sparkles className="h-5 w-5 text-olive animate-pulse" />
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">AI Summary</h4>
          {isEditing ? (
            <Textarea
              value={editedNote.summary}
              onChange={(e) => setEditedNote(prev => ({ ...prev, summary: e.target.value }))}
              className="text-base font-medium border-olive/30 focus:border-olive"
              rows={2}
            />
          ) : (
            <p className="text-base font-medium text-foreground">{note.summary}</p>
          )}
        </div>

        {/* Priority and Task Details */}
        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Priority</label>
              <Select value={editedNote.priority} onValueChange={(value) => setEditedNote(prev => ({ ...prev, priority: value as "low" | "medium" | "high" }))}>
                <SelectTrigger className="border-olive/30 focus:border-olive">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low Priority</SelectItem>
                  <SelectItem value="medium">Medium Priority</SelectItem>
                  <SelectItem value="high">High Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Due Date</label>
              <Input
                type="date"
                value={editedNote.dueDate}
                onChange={(e) => setEditedNote(prev => ({ ...prev, dueDate: e.target.value }))}
                className="border-olive/30 focus:border-olive"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Task Owner</label>
              <Select
                value={editedNote.taskOwner || "none"}
                onValueChange={(value) => setEditedNote(prev => ({ ...prev, taskOwner: value === "none" ? "" : value }))}
              >
                <SelectTrigger className="border-olive/30 focus:border-olive focus:ring-olive/20 bg-white">
                  <SelectValue placeholder="Select task owner..." />
                </SelectTrigger>
                <SelectContent className="bg-white border-olive/20 shadow-lg z-50">
                  <SelectItem value="none">No owner assigned</SelectItem>
                  {availableOwners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.name}>
                      {owner.name} {owner.isCurrentUser ? "(You)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Assign to List</label>
              <div className="space-y-2">
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
                  <SelectTrigger className="border-olive/30 focus:border-olive focus:ring-olive/20 bg-white">
                    <SelectValue placeholder="Select a list..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-olive/20 shadow-lg z-50">
                    <SelectItem value="none">No list assigned</SelectItem>
                    {lists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} {!list.is_manual && "(Auto)"}
                      </SelectItem>
                    ))}
                    <SelectItem value="new">
                      <div className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Create new list...
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                
                {showNewListInput && (
                  <div className="flex gap-2">
                    <Input
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="Enter new list name..."
                      className="border-olive/30 focus:border-olive"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newListName.trim()) {
                          handleSaveEdit();
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowNewListInput(false);
                        setNewListName("");
                      }}
                      className="text-gray-500 hover:bg-gray-100"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Badge className={getCategoryColor(note.category)}>
              {note.category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
            </Badge>
            {note.priority && (
              <Badge className={getPriorityColor(note.priority)}>
                {note.priority} priority
              </Badge>
            )}
          </div>
        )}

        {/* Items list */}
        {(isEditing || (note.items && note.items.length > 0)) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">Items</h4>
            </div>
            {isEditing ? (
              <Textarea
                value={editedNote.items}
                onChange={(e) => setEditedNote(prev => ({ ...prev, items: e.target.value }))}
                placeholder="Enter items, one per line..."
                className="border-olive/30 focus:border-olive"
                rows={4}
              />
            ) : (
              <ul className="space-y-1">
                {note.items?.slice(0, 3).map((item, index) => (
                  <li key={index} className="text-sm text-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-olive rounded-full"></span>
                    {item}
                  </li>
                ))}
                {note.items && note.items.length > 3 && (
                  <li className="text-sm text-muted-foreground">
                    +{note.items.length - 3} more items
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Tags */}
        {(isEditing || (note.tags && note.tags.length > 0)) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">Tags</h4>
            </div>
            {isEditing ? (
              <Input
                value={editedNote.tags}
                onChange={(e) => setEditedNote(prev => ({ ...prev, tags: e.target.value }))}
                placeholder="Enter tags separated by commas..."
                className="border-olive/30 focus:border-olive"
              />
            ) : (
              <div className="flex flex-wrap gap-1">
                {note.tags?.map((tag, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-4 border-t border-olive/20">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Added by {note.author}</span>
          </div>
          {note.task_owner && (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span>Owner: {note.task_owner}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{safeFormatDate(note.createdAt, "MMM d, yyyy 'at' h:mm a")}</span>
          </div>
          {note.dueDate && safeFormatDate(note.dueDate, "MMM d, yyyy") && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Due: {safeFormatDate(note.dueDate, "MMM d, yyyy")}</span>
            </div>
          )}
        </div>

        {/* Original text reference */}
        <div className="text-xs text-muted-foreground bg-white/50 p-3 rounded border border-olive/10">
          <strong>Original:</strong> "{note.originalText}"
        </div>
      </div>
    </Card>
  );
};