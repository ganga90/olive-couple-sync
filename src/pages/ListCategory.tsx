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
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const ListCategory = () => {
  const { listId = "" } = useParams();
  const navigate = useNavigate();
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists, loading, updateList, deleteList } = useSupabaseLists(currentCouple?.id || null);
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  
  const currentList = useMemo(() => 
    lists.find(list => list.id === listId), 
    [lists, listId]
  );
  
  const listNotes = useMemo(() => 
    notes.filter(note => note.list_id === listId), 
    [notes, listId]
  );

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

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <section className="mx-auto max-w-2xl px-4 py-6">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </section>
      </main>
    );
  }

  if (!currentList) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <section className="mx-auto max-w-2xl px-4 py-6">
          <Button 
            variant="ghost" 
            onClick={() => navigate('/lists')} 
            aria-label="Go back to lists"
            className="hover:bg-olive/10 hover:text-olive mb-4"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Lists
          </Button>
          <Card className="p-6 bg-white/50 border-olive/20 shadow-soft text-center">
            <p className="text-sm text-muted-foreground">List not found.</p>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              onClick={() => navigate(-1)} 
              aria-label="Go back"
              className="hover:bg-olive/10 hover:text-olive"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-olive-dark flex items-center gap-2">
                {currentList.name}
                {!currentList.is_manual && (
                  <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">
                    Auto
                  </Badge>
                )}
              </h1>
              {currentList.description && (
                <p className="text-sm text-muted-foreground">{currentList.description}</p>
              )}
            </div>
          </div>
          
          {/* Edit/Delete buttons for manual lists */}
          {currentList.is_manual && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openEditDialog}
                className="border-olive/30 hover:bg-olive/10"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteList}
                className="border-red-200 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </header>

        {listNotes.length === 0 ? (
          <Card className="p-6 bg-white/50 border-olive/20 shadow-soft text-center">
            <p className="text-sm text-muted-foreground">No items yet in this list.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {listNotes.map((note) => (
              <Link key={note.id} to={`/notes/${note.id}`} className="block" aria-label={`Open ${note.summary}`}>
                <Card className="bg-white/50 border-olive/20 shadow-soft transition-all duration-200 hover:shadow-lg hover:scale-[1.02]">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1">
                      <div className="mb-1 text-sm font-medium text-olive-dark">{note.summary}</div>
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
                          <span>Due {new Date(note.dueDate).toLocaleDateString()}</span>
                        )}
                        {note.task_owner && (
                          <span>• {note.task_owner}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-olive">›</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

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
      </section>
    </main>
  );
};

export default ListCategory;