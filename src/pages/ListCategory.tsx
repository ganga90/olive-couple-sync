import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Pencil, Trash2, CheckCircle2, Circle, Plus, ChevronDown, ChevronUp, Calendar, User, AlertCircle, Users, Lock } from "lucide-react";
import { toast } from "sonner";
import { NoteInput } from "@/components/NoteInput";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { cn } from "@/lib/utils";
import { useLocalizedNavigate, useLocalizedHref } from "@/hooks/useLocalizedNavigate";

const ListCategory = () => {
  const { listId = "" } = useParams();
  const routerNavigate = useNavigate();
  const navigate = useLocalizedNavigate();
  const getLocalizedPath = useLocalizedHref();
  const { t } = useTranslation(['lists', 'common']);
  const { notes, updateNote, deleteNote } = useSupabaseNotesContext();
  const { currentCouple, you, partner } = useSupabaseCouple();
  const { lists, loading, updateList, deleteList } = useSupabaseLists(currentCouple?.id || null);
  
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsShared, setEditIsShared] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  
  const currentList = useMemo(() => 
    lists.find(list => list.id === listId), 
    [lists, listId]
  );
  
  const listNotes = useMemo(() => 
    notes.filter(note => note.list_id === listId), 
    [notes, listId]
  );

  const { activeTasks, completedTasks, progress } = useMemo(() => {
    let filtered = listNotes;
    
    if (ownerFilter !== "all" && currentCouple) {
      filtered = filtered.filter(note => {
        const owner = note.task_owner?.toLowerCase();
        return owner === ownerFilter.toLowerCase();
      });
    }
    
    const active = filtered.filter(note => !note.completed);
    const completed = filtered.filter(note => note.completed);
    const total = filtered.length;
    const progressPercent = total > 0 ? (completed.length / total) * 100 : 0;
    return { activeTasks: active, completedTasks: completed, progress: progressPercent };
  }, [listNotes, ownerFilter, currentCouple]);

  useSEO({ 
    title: `${currentList?.name || t('listDetail.notFound')} — Olive`, 
    description: currentList?.description || t('subtitle')
  });

  const handleEditList = async () => {
    if (!currentList || !editName.trim()) return;
    
    const newCoupleId = editIsShared && currentCouple?.id ? currentCouple.id : null;
    const privacyChanged = (currentList.couple_id !== null) !== editIsShared;
    
    const result = await updateList(currentList.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      ...(privacyChanged && { couple_id: newCoupleId })
    });
    
    if (result) {
      setEditDialogOpen(false);
      toast.success(privacyChanged 
        ? (editIsShared ? t('listDetail.listShared') : t('listDetail.listMadePrivate'))
        : t('listDetail.listUpdated')
      );
    }
  };

  const handleDeleteList = async () => {
    if (!currentList) return;
    
    if (window.confirm(t('actions.deleteListConfirm', { name: currentList.name }))) {
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
      setEditIsShared(currentList.couple_id !== null);
      setEditDialogOpen(true);
    }
  };

  const handleToggleComplete = async (noteId: string, completed: boolean) => {
    try {
      await updateNote(noteId, { completed });
      toast.success(completed ? t('listDetail.itemComplete') : t('listDetail.itemIncomplete'));
    } catch (error) {
      console.error("Error updating note:", error);
      toast.error(t('listDetail.failedToUpdate'));
    }
  };

  const handleDeleteNote = async (noteId: string, summary: string) => {
    if (window.confirm(t('listDetail.deleteItemConfirm', { name: summary }))) {
      try {
        const success = await deleteNote(noteId);
        if (success) {
          toast.success(t('listDetail.itemDeleted'));
        }
      } catch (error) {
        console.error("Error deleting note:", error);
        toast.error(t('listDetail.failedToDelete'));
      }
    }
  };

  const getPriorityColor = (priority: string | null | undefined) => {
    switch (priority) {
      case 'high': return 'bg-priority-high/10 text-priority-high border-priority-high/20';
      case 'medium': return 'bg-priority-medium/10 text-priority-medium border-priority-medium/20';
      case 'low': return 'bg-priority-low/10 text-priority-low border-priority-low/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const isOverdue = (dueDate: string | null | undefined) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center animate-fade-up">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">{t('listDetail.loading')}</p>
        </div>
      </div>
    );
  }

  if (!currentList) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <Card className="max-w-md w-full shadow-card animate-fade-up">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold mb-2">{t('listDetail.notFound')}</h2>
            <p className="text-sm text-muted-foreground mb-6">{t('listDetail.notFoundDesc')}</p>
            <Button onClick={() => navigate('/lists')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t('listDetail.backToLists')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <FloatingActionButton />
      <div className="px-4 pt-6 pb-24 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-fade-up">
          <div className="flex items-start gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => routerNavigate(-1)} 
              aria-label={t('back', { ns: 'common' })}
              className="flex-shrink-0 mt-0.5 h-10 w-10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground truncate">
                  {currentList.name}
                </h1>
                {!currentList.is_manual && (
                  <Badge variant="secondary" className="text-xs bg-accent/20 text-accent flex-shrink-0">
                    {t('badges.auto')}
                  </Badge>
                )}
                {currentList.couple_id ? (
                  <Badge variant="secondary" className="text-xs bg-primary/10 text-primary flex-shrink-0 gap-1">
                    <Users className="h-3 w-3" />
                    {t('badges.shared')}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground flex-shrink-0 gap-1">
                    <Lock className="h-3 w-3" />
                    {t('badges.private')}
                  </Badge>
                )}
              </div>
              {currentList.description && (
                <p className="text-sm text-muted-foreground">{currentList.description}</p>
              )}
            </div>
            
            {currentList.is_manual && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" onClick={openEditDialog} className="h-10 w-10">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDeleteList}
                  className="h-10 w-10 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {listNotes.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('listDetail.completedOf', { completed: completedTasks.length, total: listNotes.length })}
                </span>
                <span className="font-medium text-primary">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Owner Filter */}
          {currentCouple && currentList.couple_id && you && partner && (
            <div className="flex items-center gap-2 mt-3">
              <User className="h-4 w-4 text-muted-foreground" />
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-9 w-auto min-w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('listDetail.allTasks')}</SelectItem>
                  <SelectItem value={you}>{you}</SelectItem>
                  <SelectItem value={partner}>{partner}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Add Note Button */}
        <Button
          onClick={() => setAddNoteDialogOpen(true)}
          className="w-full h-12 gap-2 shadow-soft animate-fade-up"
          style={{ animationDelay: '50ms' }}
        >
          <Plus className="h-5 w-5" />
          {t('listDetail.addNote')}
        </Button>

        {listNotes.length === 0 ? (
          <Card className="border-dashed border-2 bg-muted/20 animate-fade-up" style={{ animationDelay: '100ms' }}>
            <CardContent className="py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Plus className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{t('listDetail.noItemsYet')}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t('listDetail.noItemsDesc')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Active Tasks */}
            <div className="space-y-2">
              {activeTasks.map((note, index) => (
                <Card 
                  key={note.id} 
                  className={cn(
                    "shadow-card transition-all duration-200 hover:shadow-raised overflow-hidden animate-fade-up",
                    isOverdue(note.dueDate) && !note.completed && "border-l-4 border-l-priority-high"
                  )}
                  style={{ animationDelay: `${(index + 2) * 50}ms` }}
                >
                  <CardContent className="p-0">
                    <div className="flex items-stretch">
                      <button
                        onClick={() => handleToggleComplete(note.id, !note.completed)}
                        className="w-14 flex-shrink-0 flex items-center justify-center transition-colors hover:bg-[hsl(var(--success))]/10 border-r border-border/50"
                      >
                        <Circle className="h-6 w-6 text-muted-foreground/50 hover:text-[hsl(var(--success))] transition-colors" />
                      </button>

                      <Link 
                        to={getLocalizedPath(`/notes/${note.id}`)}
                        className="flex-1 p-4 min-w-0 hover:bg-muted/30 transition-colors"
                      >
                        <div className="font-medium text-foreground mb-2 line-clamp-2">
                          {note.summary}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">{note.category}</Badge>
                          {note.priority && (
                            <Badge className={cn("text-xs border", getPriorityColor(note.priority))}>
                              {note.priority}
                            </Badge>
                          )}
                          {note.dueDate && (
                            <span className={cn(
                              "flex items-center gap-1 text-xs",
                              isOverdue(note.dueDate) ? "text-priority-high font-medium" : "text-muted-foreground"
                            )}>
                              <Calendar className="h-3 w-3" />
                              {(() => {
                                try {
                                  const date = new Date(note.dueDate);
                                  return isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
                                } catch { return "—"; }
                              })()}
                              {isOverdue(note.dueDate) && ` (${t('stats.overdue')})`}
                            </span>
                          )}
                          {note.task_owner && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />
                              {note.task_owner}
                            </span>
                          )}
                        </div>
                      </Link>

                      <button
                        onClick={() => handleDeleteNote(note.id, note.summary)}
                        className="w-12 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border-l border-border/50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Completed Tasks Section */}
            {completedTasks.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  {showCompleted ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showCompleted 
                    ? t('listDetail.hideCompleted', { count: completedTasks.length })
                    : t('listDetail.showCompleted', { count: completedTasks.length })
                  }
                </button>
                
                {showCompleted && (
                  <div className="space-y-2">
                    {completedTasks.map((note, index) => (
                      <Card 
                        key={note.id} 
                        className="shadow-sm bg-muted/30 transition-all duration-200 overflow-hidden animate-fade-up"
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        <CardContent className="p-0">
                          <div className="flex items-stretch">
                            <button
                              onClick={() => handleToggleComplete(note.id, false)}
                              className="w-14 flex-shrink-0 flex items-center justify-center hover:bg-muted transition-colors border-r border-border/50"
                            >
                              <CheckCircle2 className="h-6 w-6 text-[hsl(var(--success))]" />
                            </button>

                            <Link 
                              to={getLocalizedPath(`/notes/${note.id}`)}
                              className="flex-1 p-4 min-w-0 hover:bg-muted/50 transition-colors"
                            >
                              <div className="font-medium text-muted-foreground line-through mb-2 line-clamp-2">
                                {note.summary}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="secondary" className="text-xs opacity-60">
                                  {note.category}
                                </Badge>
                              </div>
                            </Link>

                            <button
                              onClick={() => handleDeleteNote(note.id, note.summary)}
                              className="w-12 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border-l border-border/50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('listDetail.addNoteTitle', { name: currentList.name })}</DialogTitle>
            </DialogHeader>
            <NoteInput 
              listId={listId} 
              onNoteAdded={() => setAddNoteDialogOpen(false)} 
            />
          </DialogContent>
        </Dialog>

        {/* Edit List Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('listDetail.editList')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">{t('listDetail.listName')} *</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">{t('listDetail.description')}</Label>
                <Textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                />
              </div>
              
              {currentCouple && (
                <div className="space-y-2">
                  <Label>{t('listDetail.visibility')}</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={!editIsShared ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditIsShared(false)}
                      className="flex-1 gap-2"
                    >
                      <Lock className="h-4 w-4" />
                      {t('badges.private')}
                    </Button>
                    <Button
                      type="button"
                      variant={editIsShared ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditIsShared(true)}
                      className="flex-1 gap-2"
                    >
                      <Users className="h-4 w-4" />
                      {t('badges.shared')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {editIsShared 
                      ? t('listDetail.visibilitySharedDesc')
                      : t('listDetail.visibilityPrivateDesc')}
                  </p>
                </div>
              )}
              
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  {t('common:buttons.cancel', t('createDialog.cancel'))}
                </Button>
                <Button onClick={handleEditList} disabled={!editName.trim()}>
                  {t('listDetail.saveChanges')}
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
