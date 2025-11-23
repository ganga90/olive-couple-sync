import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseCouples } from "@/hooks/useSupabaseCouples";
import { supabase } from "@/lib/supabaseClient";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { NotePrivacyToggle } from "@/components/NotePrivacyToggle";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, User, CalendarDays, CheckCircle, Tag, UserCheck, Calendar as CalendarIcon, Bell } from "lucide-react";
import { format } from "date-fns";
import { assistWithNote } from "@/utils/oliveAssistant";
import { OliveLogo } from "@/components/OliveLogo";
import ReactMarkdown from 'react-markdown';
import { cn } from "@/lib/utils";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { NoteMediaSection } from "@/components/NoteMediaSection";

const NoteDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useUser();
  const { notes, deleteNote, updateNote } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouples();
  
  const note = useMemo(() => notes.find((n) => n.id === id), [notes, id]);

  useSEO({ title: note ? `${note.summary} — Olive` : "Note — Olive", description: note?.originalText });

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "assistant" | "user"; content: string }[]>(
    note
      ? [
          { role: "assistant", content: `Hi! How can I help with "${note.summary}"?` },
        ]
      : []
  );
  const [input, setInput] = useState("");
  
  // Master edit mode state
  const [isEditing, setIsEditing] = useState(false);
  
  // Local editing state for individual fields (existing)
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [localTaskOwner, setLocalTaskOwner] = useState<string | null>(note?.task_owner || null);
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [localDueDate, setLocalDueDate] = useState<Date | undefined>(
    note?.dueDate ? new Date(note.dueDate) : undefined
  );
  const [isEditingItems, setIsEditingItems] = useState(false);
  const [localItems, setLocalItems] = useState<string[]>(note?.items || []);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [localTags, setLocalTags] = useState<string[]>(note?.tags || []);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [localCategory, setLocalCategory] = useState<string>(note?.category || "task");
  const [newItem, setNewItem] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showReminderDialog, setShowReminderDialog] = useState(false);
  
  // Combined edit state for all fields
  const [editedNote, setEditedNote] = useState({
    summary: note?.summary || "",
    category: note?.category || "task",
    priority: note?.priority || "medium",
    tags: note?.tags ? note.tags.join(", ") : "",
    items: note?.items ? note.items.join("\n") : "",
    dueDate: note?.dueDate ? format(new Date(note.dueDate), "yyyy-MM-dd") : "",
    taskOwner: note?.task_owner || ""
  });

  // Sync local state with note when note changes
  useEffect(() => {
    if (note) {
      setLocalTaskOwner(note.task_owner || null);
      setLocalDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
      setLocalItems(note.items || []);
      setLocalTags(note.tags || []);
      setLocalCategory(note.category || "task");
      
      // Also sync the combined edit state
      setEditedNote({
        summary: note.summary || "",
        category: note.category || "task",
        priority: note.priority || "medium",
        tags: note.tags ? note.tags.join(", ") : "",
        items: note.items ? note.items.join("\n") : "",
        dueDate: note.dueDate ? format(new Date(note.dueDate), "yyyy-MM-dd") : "",
        taskOwner: note.task_owner || ""
      });
    }
  }, [note?.task_owner, note?.dueDate, note?.items, note?.tags, note?.category, note?.summary, note?.priority]);

  // Get available owners (current user and partner)
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

  if (!note) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <section className="mx-auto max-w-2xl px-4 py-8">
          <Button 
            variant="ghost" 
            onClick={() => navigate(-1)} 
            className="mb-4 hover:bg-olive/10 hover:text-olive"
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <Card className="p-6 bg-white/50 border-olive/20 shadow-soft text-center">
            <p className="text-sm text-muted-foreground">Note not found.</p>
          </Card>
        </section>
      </main>
    );
  }

  const onDelete = async () => {
    await deleteNote(note.id);
    toast.success("Note deleted");
    navigate(-1);
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text || !note) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const { reply, updates } = await assistWithNote(note, text, supabase);
    if (updates && Object.keys(updates).length) {
      await updateNote(note.id, updates);
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
  };

  const updateTaskOwner = async (newOwner: string) => {
    if (!note) return;
    
    console.log("[NoteDetails] Updating task owner from:", note.task_owner, "to:", newOwner);
    console.log("[NoteDetails] Current user:", user?.id);
    console.log("[NoteDetails] Note author_id:", note.addedBy);
    console.log("[NoteDetails] Current couple_id from note:", (note as any).couple_id);
    
    try {
      const ownerValue = newOwner === "none" ? null : newOwner;
      setLocalTaskOwner(ownerValue);
      
      console.log("[NoteDetails] Calling updateNote with task_owner:", ownerValue);
      console.log("[NoteDetails] Update payload will be:", JSON.stringify({ task_owner: ownerValue }, null, 2));
      
      const result = await updateNote(note.id, { task_owner: ownerValue });
      
      if (result) {
        console.log("[NoteDetails] Task owner update successful:", result);
        setIsEditingOwner(false);
        toast.success("Task owner updated");
      } else {
        console.error("[NoteDetails] Task owner update failed - no result returned");
        // Revert local state on failure
        setLocalTaskOwner(note.task_owner || null);
        toast.error("Failed to update task owner");
      }
    } catch (error) {
      console.error("[NoteDetails] Error updating task owner:", error);
      toast.error("Failed to update task owner");
      setLocalTaskOwner(note.task_owner || null);
    }
  };

  const updateDueDate = async (newDate: Date | undefined) => {
    if (!note) return;
    
    console.log("[NoteDetails] Updating due date from:", note.dueDate, "to:", newDate?.toISOString());
    
    try {
      const dueDateValue = newDate ? newDate.toISOString() : null;
      setLocalDueDate(newDate);
      
      console.log("[NoteDetails] Calling updateNote with due_date:", dueDateValue);
      
      const result = await updateNote(note.id, { dueDate: dueDateValue });
      
      if (result) {
        console.log("[NoteDetails] Due date update successful:", result);
        setIsEditingDueDate(false);
        toast.success("Due date updated");
      } else {
        console.error("[NoteDetails] Due date update failed - no result returned");
        // Revert local state on failure
        setLocalDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
        toast.error("Failed to update due date");
      }
    } catch (error) {
      console.error("[NoteDetails] Error updating due date:", error);
      toast.error("Failed to update due date");
      setLocalDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
    }
  };

  const updateItems = async (newItems: string[]) => {
    if (!note) return;
    
    try {
      setLocalItems(newItems);
      
      const result = await updateNote(note.id, { items: newItems });
      
      if (result) {
        setIsEditingItems(false);
        toast.success("Items updated");
      } else {
        setLocalItems(note.items || []);
        toast.error("Failed to update items");
      }
    } catch (error) {
      console.error("Error updating items:", error);
      toast.error("Failed to update items");
      setLocalItems(note.items || []);
    }
  };

  const updateTags = async (newTags: string[]) => {
    if (!note) return;
    
    try {
      setLocalTags(newTags);
      
      const result = await updateNote(note.id, { tags: newTags });
      
      if (result) {
        setIsEditingTags(false);
        toast.success("Tags updated");
      } else {
        setLocalTags(note.tags || []);
        toast.error("Failed to update tags");
      }
    } catch (error) {
      console.error("Error updating tags:", error);
      toast.error("Failed to update tags");
      setLocalTags(note.tags || []);
    }
  };

  const updateCategory = async (newCategory: string) => {
    if (!note) return;
    
    try {
      setLocalCategory(newCategory);
      
      const result = await updateNote(note.id, { category: newCategory });
      
      if (result) {
        setIsEditingCategory(false);
        toast.success("Category updated");
      } else {
        setLocalCategory(note.category || "task");
        toast.error("Failed to update category");
      }
    } catch (error) {
      console.error("Error updating category:", error);
      toast.error("Failed to update category");
      setLocalCategory(note.category || "task");
    }
  };

  const addItem = () => {
    if (newItem.trim()) {
      const updatedItems = [...localItems, newItem.trim()];
      updateItems(updatedItems);
      setNewItem("");
    }
  };

  const removeItem = (index: number) => {
    const updatedItems = localItems.filter((_, i) => i !== index);
    updateItems(updatedItems);
  };

  const addTag = () => {
    if (newTag.trim() && !localTags.includes(newTag.trim())) {
      const updatedTags = [...localTags, newTag.trim()];
      updateTags(updatedTags);
      setNewTag("");
    }
  };

  const removeTag = (index: number) => {
    const updatedTags = localTags.filter((_, i) => i !== index);
    updateTags(updatedTags);
  };

  const handleSaveEdit = async () => {
    if (!note) return;
    
    try {
      const updates = {
        summary: editedNote.summary.trim(),
        category: editedNote.category,
        priority: editedNote.priority,
        tags: editedNote.tags.split(",").map(tag => tag.trim()).filter(Boolean),
        items: editedNote.items.split("\n").map(item => item.trim()).filter(Boolean),
        dueDate: editedNote.dueDate ? new Date(editedNote.dueDate).toISOString() : null,
        task_owner: editedNote.taskOwner.trim() || null
      };

      const result = await updateNote(note.id, updates);
      if (result) {
        setIsEditing(false);
        // Reset all individual edit modes
        setIsEditingOwner(false);
        setIsEditingDueDate(false);
        setIsEditingItems(false);
        setIsEditingTags(false);
        setIsEditingCategory(false);
        toast.success("Note updated successfully!");
      }
    } catch (error) {
      console.error("Error updating note:", error);
      toast.error("Failed to update note");
    }
  };

  const handleCancelEdit = () => {
    setEditedNote({
      summary: note?.summary || "",
      category: note?.category || "task",
      priority: note?.priority || "medium",
      tags: note?.tags ? note.tags.join(", ") : "",
      items: note?.items ? note.items.join("\n") : "",
      dueDate: note?.dueDate ? format(new Date(note.dueDate), "yyyy-MM-dd") : "",
      taskOwner: note?.task_owner || ""
    });
    setIsEditing(false);
    // Reset all individual edit modes
    setIsEditingOwner(false);
    setIsEditingDueDate(false);
    setIsEditingItems(false);
    setIsEditingTags(false);
    setIsEditingCategory(false);
  };

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-olive hover:text-olive/80 underline"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <main className="h-full overflow-y-auto bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-6 pb-24">
        <header className="mb-6 flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => navigate(-1)} 
            aria-label="Go back"
            className="hover:bg-olive/10 hover:text-olive"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold text-olive-dark">Note Details</h1>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <Button 
                variant="outline" 
                size="icon" 
                aria-label="Edit note" 
                onClick={() => setIsEditing(true)}
                className="border-olive/30 hover:bg-olive/10 hover:text-olive"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveEdit}
                  className="border-green-500/30 text-green-600 hover:bg-green-50"
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="border-red-500/30 text-red-600 hover:bg-red-50"
                >
                  Cancel
                </Button>
              </div>
            )}
            <Button 
              variant="outline" 
              size="icon" 
              aria-label="Delete note" 
              onClick={onDelete}
              className="border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="space-y-6">
          {/* Header with success indicator */}
          <div className="flex items-center gap-3 text-olive-dark">
            <CheckCircle className="h-6 w-6 text-olive" />
            <h1 className="text-xl font-semibold">Note Organized!</h1>
          </div>

          {/* AI Summary Section */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">AI Summary</div>
            {isEditing ? (
              <Textarea
                value={editedNote.summary}
                onChange={(e) => setEditedNote(prev => ({ ...prev, summary: e.target.value }))}
                className="text-lg font-semibold border-olive/30 focus:border-olive resize-none"
                rows={2}
              />
            ) : (
              <h2 className="text-2xl font-semibold leading-tight text-olive-dark">{note.summary}</h2>
            )}
          </div>

          {/* Assistant and Complete Actions */}
          <div className="flex gap-3">
            <Button 
              size="lg" 
              className="flex-1 bg-olive hover:bg-olive/90 text-white shadow-soft"
              onClick={() => setChatOpen(true)}
            >
              <OliveLogo size={20} className="mr-2" />
              Ask Olive Assistant
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-green-500/30 text-green-600 hover:bg-green-50 shadow-soft"
              onClick={async () => {
                await updateNote(note.id, { completed: true });
                toast.success("Note marked as complete!");
                if (note.list_id) {
                  navigate(`/lists/${note.list_id}`);
                } else {
                  navigate("/");
                }
              }}
            >
              <CheckCircle className="h-5 w-5 mr-2" />
              Complete
            </Button>
          </div>

          {/* Category and Priority */}
          <div className="flex items-center gap-3 flex-wrap">
            {isEditing ? (
              <div className="flex items-center gap-3">
                <Select
                  value={editedNote.category}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger className="w-40 border-olive/30 focus:border-olive focus:ring-olive/20 bg-white">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-olive/20 shadow-lg z-50">
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="groceries">Groceries</SelectItem>
                    <SelectItem value="shopping">Shopping</SelectItem>
                    <SelectItem value="home_improvement">Home Improvement</SelectItem>
                    <SelectItem value="travel">Travel</SelectItem>
                    <SelectItem value="date_ideas">Date Ideas</SelectItem>
                    <SelectItem value="entertainment">Entertainment</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                    <SelectItem value="reminder">Reminder</SelectItem>
                    <SelectItem value="work">Work</SelectItem>
                    <SelectItem value="health">Health</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={editedNote.priority}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, priority: value as "low" | "medium" | "high" }))}
                >
                  <SelectTrigger className="w-32 border-olive/30 focus:border-olive focus:ring-olive/20 bg-white">
                    <SelectValue placeholder="Priority..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-olive/20 shadow-lg z-50">
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20 px-3 py-1">
                  {note.category}
                </Badge>
                {note.priority && (
                  <Badge 
                    variant="outline" 
                    className={`px-3 py-1 ${
                      note.priority === 'high' ? 'border-destructive/30 text-destructive bg-destructive/5' :
                      note.priority === 'medium' ? 'border-yellow-500/30 text-yellow-600 bg-yellow-50' :
                      'border-green-500/30 text-green-600 bg-green-50'
                    }`}
                  >
                    {note.priority} priority
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Tags Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-olive-dark mb-2">
                <Tag className="h-4 w-4 text-olive" />
                <span>Tags</span>
              </div>
              <div>
                {isEditing ? (
                  <Textarea
                    value={editedNote.tags}
                    onChange={(e) => setEditedNote(prev => ({ ...prev, tags: e.target.value }))}
                    placeholder="Enter tags separated by commas..."
                    className="border-olive/30 focus:border-olive resize-none"
                    rows={2}
                  />
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {note.tags && note.tags.length > 0 ? (
                      note.tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="bg-olive/5 border-olive/20 text-olive-dark">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No tags yet</span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Items List */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="text-xs font-medium text-olive-dark uppercase tracking-wide mb-3">Items</div>
              {isEditing ? (
                <Textarea
                  value={editedNote.items}
                  onChange={(e) => setEditedNote(prev => ({ ...prev, items: e.target.value }))}
                  placeholder="Enter items, one per line..."
                  className="border-olive/30 focus:border-olive resize-none"
                  rows={4}
                />
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-olive-dark">
                  {note.items && note.items.length > 0 ? (
                    note.items.map((item, idx) => (
                      <li key={idx}>{renderTextWithLinks(item)}</li>
                    ))
                  ) : (
                    <p className="text-muted-foreground">No items yet</p>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Task Owner Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-olive-dark mb-2">
                <UserCheck className="h-4 w-4 text-olive" />
                <span>Task Owner</span>
              </div>
              <div>
                {isEditing ? (
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
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {note.task_owner || "No owner assigned"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Due Date Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-olive-dark mb-2">
                <CalendarIcon className="h-4 w-4 text-olive" />
                <span>Due Date</span>
              </div>
              <div>
                {isEditing ? (
                  <input
                    type="date"
                    value={editedNote.dueDate}
                    onChange={(e) => setEditedNote(prev => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-olive/30 rounded-md focus:border-olive focus:ring-olive/20 text-sm"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {note.dueDate ? format(new Date(note.dueDate), "PPP") : "No due date set"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Reminder Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium text-olive-dark">
                  <Bell className="h-4 w-4 text-olive" />
                  <span>Reminder</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReminderDialog(true)}
                  className="text-olive hover:text-olive-dark hover:bg-olive/10"
                >
                  {note.reminder_time ? "Edit" : "Set"} Reminder
                </Button>
              </div>
              <div className="space-y-2">
                {note.reminder_time ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(note.reminder_time), "PPP 'at' p")}
                    </p>
                    {note.recurrence_frequency && note.recurrence_frequency !== 'none' && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="font-medium">Repeats:</span>
                        Every {note.recurrence_interval && note.recurrence_interval > 1 ? note.recurrence_interval : ''} {note.recurrence_frequency}
                        {note.recurrence_interval && note.recurrence_interval > 1 ? 's' : ''}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No reminder set</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Media & Attachments Section */}
          <NoteMediaSection mediaUrls={note.media_urls} location={note.location} />

          {/* Metadata */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-olive" /> 
                <span>Added by {note.addedBy || 'You'}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-olive" /> 
                <span>{format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            </div>
            
            <NotePrivacyToggle note={note} size="sm" variant="outline" />
          </div>

          {/* Original Text */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="mb-3 text-xs font-medium text-olive-dark uppercase tracking-wide">Original</div>
              <p className="text-sm text-muted-foreground italic">"{renderTextWithLinks(note.originalText)}"</p>
            </CardContent>
          </Card>

        </div>
      </section>

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="bg-white border-olive/20 shadow-soft">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-olive-dark">
              <OliveLogo size={20} />
              Olive Assistant
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-md bg-olive/5 border border-olive/10 p-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={
                  m.role === "user"
                    ? "inline-block rounded-lg bg-olive text-white px-3 py-2 shadow-soft"
                    : "inline-block rounded-lg bg-white border border-olive/20 px-3 py-2 text-olive-dark shadow-soft"
                }>
                  {m.role === "user" ? (
                    m.content
                  ) : (
                    <ReactMarkdown 
                      components={{
                        ul: ({children}) => <ul className="list-disc pl-4 space-y-1 text-sm">{children}</ul>,
                        li: ({children}) => <li className="text-sm">{children}</li>,
                        strong: ({children}) => <strong className="font-semibold text-olive-dark">{children}</strong>,
                        p: ({children}) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question..."
              rows={3}
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
            />
            <DialogFooter>
              <Button 
                onClick={onSend}
                className="bg-olive hover:bg-olive/90 text-white"
              >
                Send
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reminder Dialog */}
      {note && (
        <QuickEditReminderDialog
          open={showReminderDialog}
          onOpenChange={setShowReminderDialog}
          note={note}
        />
      )}
    </main>
  );
};

export default NoteDetails;