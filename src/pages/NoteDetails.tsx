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
import { NotePrivacyToggle } from "@/components/NotePrivacyToggle";
import { toast } from "sonner";
import { 
  ArrowLeft, Pencil, Trash2, User, CalendarDays, CheckCircle2, Tag, 
  UserCheck, Calendar as CalendarIcon, Bell, RotateCcw, Loader2,
  Clock, AlertTriangle, ChevronRight, Sparkles, MessageSquare, ExternalLink,
  Phone, MapPin, FileText, DollarSign, Info, Link2
} from "lucide-react";
import { format, isPast, parseISO } from "date-fns";
import { assistWithNote, clearNoteConversation } from "@/utils/oliveAssistant";
import { OliveLogo } from "@/components/OliveLogo";
import ReactMarkdown from 'react-markdown';
import { cn } from "@/lib/utils";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { NoteMediaSection } from "@/components/NoteMediaSection";
import { AddToCalendarButton } from "@/components/AddToCalendarButton";
import { OliveTipsSection } from "@/components/OliveTipsSection";

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
    note ? [{ role: "assistant", content: `Hi! How can I help with "${note.summary}"?` }] : []
  );
  const [input, setInput] = useState("");
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showReminderDialog, setShowReminderDialog] = useState(false);
  
  const [editedNote, setEditedNote] = useState({
    summary: note?.summary || "",
    category: note?.category || "task",
    priority: note?.priority || "medium",
    tags: note?.tags ? note.tags.join(", ") : "",
    items: note?.items ? note.items.join("\n") : "",
    dueDate: note?.dueDate ? format(new Date(note.dueDate), "yyyy-MM-dd") : "",
    taskOwner: note?.task_owner || ""
  });

  useEffect(() => {
    if (note) {
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

  const availableOwners = useMemo(() => {
    const owners = [];
    if (user?.fullName) {
      owners.push({ id: user.id, name: currentCouple?.you_name || user.fullName, isCurrentUser: true });
    }
    if (currentCouple?.partner_name) {
      owners.push({ id: 'partner', name: currentCouple.partner_name, isCurrentUser: false });
    }
    return owners;
  }, [user, currentCouple]);

  const isOverdue = note?.dueDate && !note.completed && isPast(parseISO(note.dueDate));

  if (!note) {
    return (
      <main className="min-h-screen bg-background">
        <section className="mx-auto max-w-2xl px-4 py-8">
          <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <Card className="p-6 text-center border-border/50 shadow-card">
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
    if (!text || !note || isAssistantLoading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsAssistantLoading(true);
    
    try {
      const { reply, updates } = await assistWithNote(note, text, supabase);
      if (updates && Object.keys(updates).length) {
        await updateNote(note.id, updates);
      }
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (error) {
      console.error("Error getting assistance:", error);
      setMessages((prev) => [...prev, { 
        role: "assistant", 
        content: "Sorry, I'm having trouble connecting right now. Please try again." 
      }]);
    } finally {
      setIsAssistantLoading(false);
    }
  };

  const handleNewConversation = async () => {
    if (!note) return;
    await clearNoteConversation(note.id, supabase);
    setMessages([{ role: "assistant", content: `Hi! How can I help with "${note.summary}"?` }]);
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
        toast.success("Note updated!");
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
  };

  const renderTextWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
            {part}
          </a>
        );
      }
      return part;
    });
  };

  // Parse item to detect label and value, and get appropriate icon
  const parseItem = (item: string) => {
    const colonIndex = item.indexOf(':');
    if (colonIndex > 0 && colonIndex < 30) {
      const label = item.substring(0, colonIndex).trim().toLowerCase();
      const value = item.substring(colonIndex + 1).trim();
      
      // Determine icon based on label
      let icon = <Info className="h-3.5 w-3.5 text-muted-foreground" />;
      let isLink = false;
      
      if (label.includes('website') || label.includes('url') || label.includes('link')) {
        icon = <ExternalLink className="h-3.5 w-3.5 text-primary" />;
        isLink = /^https?:\/\//i.test(value);
      } else if (label.includes('phone') || label.includes('tel')) {
        icon = <Phone className="h-3.5 w-3.5 text-success" />;
      } else if (label.includes('address') || label.includes('location') || label.includes('venue')) {
        icon = <MapPin className="h-3.5 w-3.5 text-accent" />;
      } else if (label.includes('price') || label.includes('cost') || label.includes('discount')) {
        icon = <DollarSign className="h-3.5 w-3.5 text-priority-medium" />;
      } else if (label.includes('time') || label.includes('hour') || label.includes('date') || label.includes('expires')) {
        icon = <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
      } else if (label.includes('code') || label.includes('promo')) {
        icon = <Tag className="h-3.5 w-3.5 text-primary" />;
      } else if (label.includes('note') || label.includes('purpose') || label.includes('condition')) {
        icon = <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
      } else if (label.includes('provider') || label.includes('doctor') || label.includes('dr.')) {
        icon = <User className="h-3.5 w-3.5 text-primary" />;
      }
      
      return { label: item.substring(0, colonIndex).trim(), value, icon, isLink };
    }
    
    // No label found, check if it's a URL
    const isUrl = /^https?:\/\//i.test(item);
    return { 
      label: null, 
      value: item, 
      icon: isUrl ? <Link2 className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />,
      isLink: isUrl 
    };
  };

  const getPriorityConfig = (priority: string | undefined) => {
    switch (priority) {
      case 'high':
        return { color: 'bg-priority-high', text: 'text-priority-high', bg: 'bg-priority-high/10', label: 'High Priority' };
      case 'medium':
        return { color: 'bg-priority-medium', text: 'text-priority-medium', bg: 'bg-priority-medium/10', label: 'Medium Priority' };
      case 'low':
        return { color: 'bg-priority-low', text: 'text-priority-low', bg: 'bg-priority-low/10', label: 'Low Priority' };
      default:
        return { color: 'bg-muted', text: 'text-muted-foreground', bg: 'bg-muted/50', label: 'No Priority' };
    }
  };

  const priorityConfig = getPriorityConfig(note.priority);

  return (
    <main className="h-full overflow-y-auto bg-background">
      <section className="mx-auto max-w-2xl px-4 pt-4 pb-24 md:pb-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-6 animate-fade-up">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="touch-target">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} className="touch-target">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={onDelete}
                  className="touch-target text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="default" size="sm" onClick={handleSaveEdit}>Save</Button>
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>Cancel</Button>
              </>
            )}
          </div>
        </header>

        <div className="space-y-5">
          {/* Priority Bar + Title */}
          <div className="animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className={cn("h-1.5 w-full rounded-full mb-4", priorityConfig.color)} />
            
            {isEditing ? (
              <Textarea
                value={editedNote.summary}
                onChange={(e) => setEditedNote(prev => ({ ...prev, summary: e.target.value }))}
                className="text-xl font-bold border-border/50 focus:border-primary resize-none"
                rows={2}
              />
            ) : (
              <h1 className="text-2xl font-bold text-foreground leading-tight">{note.summary}</h1>
            )}
          </div>

          {/* Quick Info Badges */}
          <div className="flex flex-wrap items-center gap-2 animate-fade-up" style={{ animationDelay: '100ms' }}>
            {isEditing ? (
              <div className="flex items-center gap-2 w-full">
                <Select
                  value={editedNote.category}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger className="w-36 h-9 text-sm">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="groceries">Groceries</SelectItem>
                    <SelectItem value="shopping">Shopping</SelectItem>
                    <SelectItem value="home_improvement">Home</SelectItem>
                    <SelectItem value="travel">Travel</SelectItem>
                    <SelectItem value="date_ideas">Date Ideas</SelectItem>
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
                  <SelectTrigger className="w-32 h-9 text-sm">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <Badge variant="secondary" className="capitalize">{note.category}</Badge>
                <Select
                  value={note.priority || "medium"}
                  onValueChange={async (value) => {
                    await updateNote(note.id, { priority: value as "low" | "medium" | "high" });
                    toast.success("Priority updated!");
                  }}
                >
                  <SelectTrigger className={cn("h-7 w-auto gap-1 border-0 px-2.5 text-xs font-medium", priorityConfig.bg, priorityConfig.text)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Priority</SelectItem>
                    <SelectItem value="medium">Medium Priority</SelectItem>
                    <SelectItem value="high">High Priority</SelectItem>
                  </SelectContent>
                </Select>
                {isOverdue && (
                  <Badge className="bg-priority-high/10 text-priority-high border-0">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Overdue
                  </Badge>
                )}
                {note.completed && (
                  <Badge className="bg-success/10 text-success border-0">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Completed
                  </Badge>
                )}
              </>
            )}
          </div>

          {/* Action Buttons */}
          {!note.completed && (
            <div className="flex flex-col gap-2 animate-fade-up" style={{ animationDelay: '150ms' }}>
              <div className="flex gap-2">
                <Button 
                  variant="accent"
                  size="lg" 
                  className="flex-1"
                  onClick={() => setChatOpen(true)}
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Ask Olive
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 border-success/30 text-success hover:bg-success/10"
                  onClick={async () => {
                    await updateNote(note.id, { completed: true });
                    toast.success("Marked as complete!");
                    navigate(note.list_id ? `/lists/${note.list_id}` : "/");
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Complete
                </Button>
              </div>
              {/* Add to Google Calendar */}
              {(note.dueDate || note.reminder_time) && (
                <AddToCalendarButton note={note} size="lg" className="w-full" />
              )}
            </div>
          )}

          {/* Olive Tips Section - Prominent placement */}
          <div className="animate-fade-up" style={{ animationDelay: '175ms' }}>
            <OliveTipsSection note={note} />
          </div>

          {/* Info Cards Grid */}
          <div className="grid grid-cols-2 gap-3 animate-fade-up" style={{ animationDelay: '200ms' }}>
            {/* Due Date Card */}
            <Card className="border-border/50 shadow-card">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarIcon className={cn("h-4 w-4", isOverdue ? "text-priority-high" : "text-primary")} />
                  <span className="text-xs font-medium text-muted-foreground">Due Date</span>
                </div>
                {isEditing ? (
                  <input
                    type="date"
                    value={editedNote.dueDate}
                    onChange={(e) => setEditedNote(prev => ({ ...prev, dueDate: e.target.value }))}
                    className="w-full px-2 py-1 text-sm border rounded-lg border-border/50"
                  />
                ) : (
                  <p className={cn("text-sm font-medium", isOverdue ? "text-priority-high" : "text-foreground")}>
                    {note.dueDate ? format(new Date(note.dueDate), "MMM d, yyyy") : "Not set"}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Reminder Card */}
            <Card 
              className="border-border/50 shadow-card cursor-pointer hover:shadow-raised transition-shadow"
              onClick={() => !isEditing && setShowReminderDialog(true)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-accent" />
                    <span className="text-xs font-medium text-muted-foreground">Reminder</span>
                  </div>
                  {!isEditing && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                </div>
                <p className="text-sm font-medium text-foreground">
                  {note.reminder_time ? format(new Date(note.reminder_time), "MMM d, h:mm a") : "Not set"}
                </p>
              </CardContent>
            </Card>

            {/* Task Owner Card */}
            <Card className="border-border/50 shadow-card">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">Owner</span>
                </div>
                {isEditing ? (
                  <Select
                    value={editedNote.taskOwner || "none"}
                    onValueChange={(value) => setEditedNote(prev => ({ ...prev, taskOwner: value === "none" ? "" : value }))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Select..." />
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
                ) : (
                  <p className="text-sm font-medium text-foreground">{note.task_owner || "Unassigned"}</p>
                )}
              </CardContent>
            </Card>

            {/* Privacy Card */}
            <Card className="border-border/50 shadow-card">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <User className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">Privacy</span>
                </div>
                <NotePrivacyToggle note={note} size="sm" variant="ghost" />
              </CardContent>
            </Card>
          </div>

          {/* Tags Section */}
          <Card className="border-border/50 shadow-card animate-fade-up" style={{ animationDelay: '250ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Tags</span>
              </div>
              {isEditing ? (
                <Textarea
                  value={editedNote.tags}
                  onChange={(e) => setEditedNote(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="Enter tags separated by commas..."
                  className="border-border/50 resize-none text-sm"
                  rows={2}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {note.tags?.length ? (
                    note.tags.map((tag, idx) => (
                      <Badge key={idx} variant="outline" className="bg-muted/50">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No tags</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Details/Sub-tasks Section */}
          <Card className="border-border/50 shadow-card animate-fade-up" style={{ animationDelay: '300ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold text-foreground">Details & Sub-tasks</span>
                {note.items?.length && !isEditing && (
                  <Badge variant="secondary" className="text-[10px] h-5">{note.items.length}</Badge>
                )}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <Textarea
                    value={editedNote.items}
                    onChange={(e) => setEditedNote(prev => ({ ...prev, items: e.target.value }))}
                    placeholder="Add details, one per line... (e.g., Website: https://..., Phone: 555-1234)"
                    className="border-border/50 resize-none text-sm"
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: Use "Label: Value" format for better organization
                  </p>
                </div>
              ) : note.items?.length ? (
                <div className="space-y-2">
                  {note.items.map((item, idx) => {
                    const parsed = parseItem(item);
                    return (
                      <div 
                        key={idx} 
                        className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {parsed.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          {parsed.label ? (
                            <div className="space-y-0.5">
                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                {parsed.label}
                              </span>
                              <p className="text-sm text-foreground break-words">
                                {parsed.isLink ? (
                                  <a 
                                    href={parsed.value} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    {parsed.value.length > 50 ? parsed.value.substring(0, 50) + '...' : parsed.value}
                                    <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </a>
                                ) : (
                                  renderTextWithLinks(parsed.value)
                                )}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-foreground break-words">
                              {parsed.isLink ? (
                                <a 
                                  href={parsed.value} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-primary hover:underline inline-flex items-center gap-1"
                                >
                                  {parsed.value.length > 50 ? parsed.value.substring(0, 50) + '...' : parsed.value}
                                  <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </a>
                              ) : (
                                renderTextWithLinks(parsed.value)
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No additional details. Click edit to add sub-tasks, links, or notes.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Media Section */}
          <div className="animate-fade-up" style={{ animationDelay: '350ms' }}>
            <NoteMediaSection mediaUrls={note.media_urls} location={note.location} />
          </div>

          {/* Original Text */}
          <Card className="border-border/50 shadow-card bg-muted/30 animate-fade-up" style={{ animationDelay: '400ms' }}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Original</span>
              </div>
              <p className="text-sm text-muted-foreground italic leading-relaxed">
                "{renderTextWithLinks(note.originalText)}"
              </p>
            </CardContent>
          </Card>

          {/* Metadata Footer */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 animate-fade-up" style={{ animationDelay: '450ms' }}>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {note.addedBy || 'You'}
              </span>
              <span className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {format(new Date(note.createdAt), "MMM d, yyyy")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Olive Assistant Dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <OliveLogo size={20} />
                <span>Olive Assistant</span>
              </div>
              <Button variant="ghost" size="icon" onClick={handleNewConversation} className="h-8 w-8">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-muted/50 border border-border/50 p-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={cn(
                  "inline-block rounded-xl px-3 py-2 max-w-[85%] text-sm",
                  m.role === "user" 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-card border border-border/50 text-foreground"
                )}>
                  {m.role === "user" ? m.content : (
                    <ReactMarkdown 
                      components={{
                        a: ({href, children}) => (
                          <a 
                            href={href} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                          >
                            {children}
                            <ExternalLink className="h-3 w-3 inline ml-0.5 opacity-70" />
                          </a>
                        ),
                        ul: ({children}) => <ul className="list-disc pl-4 space-y-1 my-2">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal pl-4 space-y-1 my-2">{children}</ol>,
                        li: ({children}) => <li className="leading-relaxed">{children}</li>,
                        strong: ({children}) => <strong className="font-semibold text-foreground">{children}</strong>,
                        em: ({children}) => <em className="italic text-muted-foreground">{children}</em>,
                        p: ({children}) => <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,
                        h3: ({children}) => <h3 className="font-semibold text-sm mt-3 mb-1">{children}</h3>,
                        code: ({children}) => (
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">
                            {children}
                          </code>
                        ),
                        blockquote: ({children}) => (
                          <blockquote className="border-l-2 border-primary/50 pl-3 italic text-muted-foreground my-2">
                            {children}
                          </blockquote>
                        ),
                        hr: () => <hr className="my-3 border-border/50" />
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            {isAssistantLoading && (
              <div className="text-left">
                <div className="inline-flex items-center gap-2 rounded-xl bg-card border border-border/50 px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about this note..."
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
            />
            <DialogFooter>
              <Button onClick={onSend} disabled={isAssistantLoading || !input.trim()}>
                {isAssistantLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
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
