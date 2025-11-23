import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Pencil, Trash2, CheckCircle2, Circle, Plus } from "lucide-react";
import { toast } from "sonner";
import { NoteInput } from "@/components/NoteInput";
import { FloatingActionButton } from "@/components/FloatingActionButton";

const ListCategory = () => {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const { notes, updateNote, deleteNote } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists, loading, updateList, deleteList } = useSupabaseLists(currentCouple?.id || null);
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false);
  
  const currentList = useMemo(() => 
    lists.find(list => list.id === listId), 
    [lists, listId]
  );
  
  const listNotes = useMemo(() => 
    notes.filter(note => note.list_id === listId), 
    [notes, listId]
  );

  const { activeTasks, completedTasks } = useMemo(() => {
    const active = listNotes.filter(note => !note.completed);
    const completed = listNotes.filter(note => note.completed);
    return { activeTasks: active, completedTasks: completed };
  }, [listNotes]);

  useSEO({ 
    title: `${currentList?.name || 'List'} — Olive`, 
    description: `Browse items in ${currentList?.name || 'this'} list.` 
  });

  const handleEditList = async () => {
    if (!currentList || !editName.trim()) return;
    
    const result = await updateList(currentList.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined
    });
    
    if (result) {
      setEditDialogOpen(false);
      toast.success("List updated successfully");
    }
  };

  const handleDeleteList = async () => {
    if (!currentList) return;
    
    if (window.confirm(`Are you sure you want to delete "${currentList.name}"? This will not delete the notes, but they will no longer be organized in this list.`)) {
      const success = await deleteList(currentList.id);
      if (success) {
        navigate('/lists');
      }
    }
  };

  const openEditDialog = () => {
    if (currentList) {
      setEditName(currentList.name);
      setEditDescription(currentList.description || "");
      setEditDialogOpen(true);
    }
  };

  const handleToggleComplete = async (noteId: string, completed: boolean) => {
    try {
      await updateNote(noteId, { completed });
      toast.success(completed ? "Item marked as complete" : "Item marked as incomplete");
    } catch (error) {
      console.error("Error updating note:", error);
      toast.error("Failed to update item");
    }
  };

  const handleDeleteNote = async (noteId: string, summary: string) => {
    if (window.confirm(`Are you sure you want to delete "${summary}"?`)) {
      try {
        const success = await deleteNote(noteId);
        if (success) {
          toast.success("Item deleted successfully");
        }
      } catch (error) {
        console.error("Error deleting note:", error);
        toast.error("Failed to delete item");
      }
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
          <p className="text-sm text-muted-foreground">Loading list...</p>
        </div>
      </div>
    );
  }

  if (!currentList) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <Card className="max-w-md w-full shadow-[var(--shadow-card)] border-border/50">
          <CardContent className="p-8 text-center">
            <Button 
              variant="ghost" 
              onClick={() => navigate('/lists')} 
              aria-label="Go back to lists"
              className="mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Lists
            </Button>
            <p className="text-sm text-muted-foreground">List not found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <FloatingActionButton />
      <div className="px-4 pt-6 pb-24 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(-1)} 
            aria-label="Go back"
            className="flex-shrink-0 mt-0.5"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl md:text-2xl font-bold text-foreground truncate">
                {currentList.name}
              </h1>
              {!currentList.is_manual && (
                <Badge variant="secondary" className="text-xs bg-accent/80 text-accent-foreground flex-shrink-0">
                  Auto
                </Badge>
              )}
            </div>
            {currentList.description && (
              <p className="text-sm text-muted-foreground">{currentList.description}</p>
            )}
          </div>
          
          {/* Edit/Delete buttons for manual lists */}
          {currentList.is_manual && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={openEditDialog}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDeleteList}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Add Note Button */}
        <div className="mb-6">
          <Button
            onClick={() => setAddNoteDialogOpen(true)}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add a note
          </Button>
        </div>

        {listNotes.length === 0 ? (
          <Card className="p-6 bg-white/50 border-olive/20 shadow-soft text-center">
            <p className="text-sm text-muted-foreground">No items yet in this list.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Active Tasks */}
            <div className="space-y-3">
              {activeTasks.map((note) => (
                <Card key={note.id} className="bg-white/50 border-olive/20 shadow-soft transition-all duration-200 hover:shadow-lg">
                  <CardContent className="flex items-center gap-3 p-4">
                    {/* Checkbox for completion */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        handleToggleComplete(note.id, !note.completed);
                      }}
                      className={`p-1 rounded-full ${note.completed 
                        ? 'text-green-600 hover:bg-green-50' 
                        : 'text-gray-400 hover:bg-gray-50'
                      }`}
                    >
                       {note.completed ? (
                         <CheckCircle2 className="h-5 w-5" />
                       ) : (
                         <Circle className="h-5 w-5" />
                       )}
                    </Button>

                    {/* Note content - clickable to view details */}
                    <Link 
                      to={`/notes/${note.id}`} 
                      className="flex-1 min-w-0" 
                      aria-label={`Open ${note.summary}`}
                    >
                      <div className={`mb-1 text-sm font-medium transition-all ${
                        note.completed 
                          ? 'text-muted-foreground line-through' 
                          : 'text-olive-dark'
                      }`}>
                        {note.summary}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20">
                          {note.category}
                        </Badge>
                        {note.priority && (
                          <Badge variant="secondary" className={
                            note.priority === 'high' ? 'bg-red-100 text-red-800' :
                            note.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }>
                            {note.priority} priority
                          </Badge>
                        )}
                        {note.dueDate && (
                        <span>Due {(() => {
                          try {
                            const date = new Date(note.dueDate);
                            return isNaN(date.getTime()) ? "Invalid Date" : date.toLocaleDateString();
                          } catch {
                            return "Invalid Date";
                          }
                        })()}</span>
                        )}
                        {note.task_owner && (
                          <span>• {note.task_owner}</span>
                        )}
                      </div>
                    </Link>

                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        handleDeleteNote(note.id, note.summary);
                      }}
                      className="p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Completed Tasks Section */}
            {completedTasks.length > 0 && (
              <div className="space-y-3">
                <Button
                  variant="ghost"
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="text-sm text-muted-foreground hover:text-olive flex items-center gap-2"
                >
                  {showCompleted ? 'Hide' : 'Show'} completed tasks ({completedTasks.length})
                </Button>
                
                {showCompleted && (
                  <div className="space-y-3">
                    {completedTasks.map((note) => (
                      <Card key={note.id} className="bg-white/30 border-olive/10 shadow-soft transition-all duration-200 opacity-60">
                        <CardContent className="flex items-center gap-3 p-4">
                          {/* Checkbox for completion */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              handleToggleComplete(note.id, !note.completed);
                            }}
                            className="p-1 rounded-full text-green-600 hover:bg-green-50"
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </Button>

                          {/* Note content - clickable to view details */}
                          <Link 
                            to={`/notes/${note.id}`} 
                            className="flex-1 min-w-0" 
                            aria-label={`Open ${note.summary}`}
                          >
                            <div className="mb-1 text-sm font-medium text-muted-foreground line-through">
                              {note.summary}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                              <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20">
                                {note.category}
                              </Badge>
                              {note.priority && (
                                <Badge variant="secondary" className={
                                  note.priority === 'high' ? 'bg-red-100 text-red-800' :
                                  note.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-green-100 text-green-800'
                                }>
                                  {note.priority} priority
                                </Badge>
                              )}
                              {note.dueDate && (
                                <span>Due {(() => {
                                  try {
                                    const date = new Date(note.dueDate);
                                    return isNaN(date.getTime()) ? "Invalid Date" : date.toLocaleDateString();
                                  } catch {
                                    return "Invalid Date";
                                  }
                                })()}</span>
                              )}
                              {note.task_owner && (
                                <span>• {note.task_owner}</span>
                              )}
                            </div>
                          </Link>

                          {/* Delete button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              handleDeleteNote(note.id, note.summary);
                            }}
                            className="p-1 text-red-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Add Note Dialog */}
        <Dialog open={addNoteDialogOpen} onOpenChange={setAddNoteDialogOpen}>
          <DialogContent className="bg-white max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-olive-dark">Add Note to {currentList.name}</DialogTitle>
            </DialogHeader>
            <NoteInput 
              listId={listId} 
              onNoteAdded={() => {
                setAddNoteDialogOpen(false);
              }} 
            />
          </DialogContent>
        </Dialog>

        {/* Edit List Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="text-olive-dark">Edit List</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name" className="text-sm font-medium text-olive-dark">
                  List Name *
                </Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="border-olive/30 focus:border-olive focus:ring-olive/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description" className="text-sm font-medium text-olive-dark">
                  Description
                </Label>
                <Textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="border-olive/30 focus:border-olive focus:ring-olive/20"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  className="border-olive/30"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEditList}
                  disabled={!editName.trim()}
                  className="bg-olive hover:bg-olive/90 text-white"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default ListCategory;