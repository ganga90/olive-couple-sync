import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { supabase } from "@/lib/supabaseClient";
import { useSEO } from "@/hooks/useSEO";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NotePrivacyToggle } from "@/components/NotePrivacyToggle";
import { toast } from "sonner";
import { 
  ArrowLeft, Pencil, Trash2, User, CalendarDays, CheckCircle2, Tag, 
  UserCheck, Calendar as CalendarIcon, Bell, RotateCcw, Loader2,
  Clock, AlertTriangle, ChevronRight, Sparkles, MessageSquare, ExternalLink,
  Phone, MapPin, FileText, DollarSign, Info, Link2, ListTodo
} from "lucide-react";
import { format, isPast, parseISO, parse, isValid } from "date-fns";
import { assistWithNote, clearNoteConversation } from "@/utils/oliveAssistant";
import { OliveLogo } from "@/components/OliveLogo";
import ReactMarkdown from 'react-markdown';
import { cn } from "@/lib/utils";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { NoteMediaSection } from "@/components/NoteMediaSection";
import { AddToCalendarDialog } from "@/components/AddToCalendarDialog";
import { AddToGoogleTasksDialog } from "@/components/AddToGoogleTasksDialog";
import { OliveTipsSection } from "@/components/OliveTipsSection";
import { DueDateChip } from "@/components/DueDateChip";
import { useOnboardingTooltip } from "@/hooks/useOnboardingTooltip";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";

const NoteDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const getLocalizedPath = useLocalizedHref();
  const { user } = useUser();
  const { t } = useTranslation('notes');
  const { notes, deleteNote, updateNote } = useSupabaseNotesContext();
  const { currentCouple, you, partner } = useSupabaseCouple();
  const { lists } = useSupabaseLists(currentCouple?.id);
  const askOliveOnboarding = useOnboardingTooltip('ask-olive-chat');
  const { connection: calendarConnection } = useCalendarEvents();
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
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [newItems, setNewItems] = useState("");
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
  
  // Helper to safely format dates without timezone shift
  const formatDateSafely = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    const dateOnly = dateStr.split('T')[0];
    return dateOnly; // Returns YYYY-MM-DD
  };

  // Helper to convert YYYY-MM-DD to storage format (noon UTC to avoid shifts)
  const toStorageFormat = (dateStr: string): string => {
    if (!dateStr) return '';
    return `${dateStr}T12:00:00.000Z`;
  };
  
  const [editedNote, setEditedNote] = useState({
    summary: note?.summary || "",
    category: note?.category || "task",
    priority: note?.priority || "medium",
    tags: note?.tags ? note.tags.join(", ") : "",
    items: note?.items ? note.items.join("\n") : "",
    dueDate: formatDateSafely(note?.dueDate),
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
        dueDate: formatDateSafely(note.dueDate),
        taskOwner: note.task_owner || ""
      });
    }
  }, [note?.task_owner, note?.dueDate, note?.items, note?.tags, note?.category, note?.summary, note?.priority]);

  const availableOwners = useMemo(() => {
    const owners = [];
    // Use resolved names (dynamically swapped based on logged-in user)
    if (you) {
      owners.push({ id: user?.id || 'you', name: you, isCurrentUser: true });
    } else if (user?.fullName) {
      owners.push({ id: user.id, name: user.fullName, isCurrentUser: true });
    }
    if (partner) {
      owners.push({ id: 'partner', name: partner, isCurrentUser: false });
    }
    return owners;
  }, [user, you, partner]);

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
        dueDate: editedNote.dueDate ? toStorageFormat(editedNote.dueDate) : null,
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
      dueDate: formatDateSafely(note?.dueDate),
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
    <main className="h-full overflow-y-auto bg-background atmosphere-bg">
      <section className="mx-auto max-w-2xl px-4 pt-4 pb-24 md:pb-8 relative z-10">
        {/* Header - Transparent */}
        <header className="flex items-center justify-between mb-8 animate-fade-up">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="touch-target -ml-2">
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

        <div className="space-y-6">
          {/* Priority Bar + Massive Title */}
          <div className="animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className={cn("h-1.5 w-24 rounded-full mb-6", priorityConfig.color)} />
            
            {isEditing ? (
              <Textarea
                value={editedNote.summary}
                onChange={(e) => setEditedNote(prev => ({ ...prev, summary: e.target.value }))}
                className="heading-massive border-stone-200 focus:border-primary resize-none bg-transparent"
                rows={2}
              />
            ) : (
              <h1 className="heading-massive leading-tight">{note.summary}</h1>
            )}
          </div>

          {/* Meta Chips Row - Horizontal Scrollable */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-thin animate-fade-up" style={{ animationDelay: '100ms' }}>
            {isEditing ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={editedNote.category}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger className="h-9 w-36 text-sm rounded-full">
                    <SelectValue placeholder="Select list" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((list) => (
                      <SelectItem key={list.id} value={list.name.toLowerCase().replace(/\s+/g, '_')}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={editedNote.priority}
                  onValueChange={(value) => setEditedNote(prev => ({ ...prev, priority: value as "low" | "medium" | "high" }))}
                >
                  <SelectTrigger className="h-9 w-32 text-sm rounded-full">
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
                {/* List Chip */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="meta-chip whitespace-nowrap hover:bg-stone-100 transition-colors">
                      📋 {(() => {
                        // Look up list name from list_id first, fallback to category
                        const assignedList = lists.find(l => l.id === note.list_id);
                        if (assignedList) return assignedList.name;
                        // Fallback: try to match category to a list name
                        const matchedList = lists.find(l => 
                          l.name.toLowerCase().replace(/\s+/g, '_') === note.category.toLowerCase() ||
                          l.name.toLowerCase() === note.category.toLowerCase()
                        );
                        return matchedList?.name || note.category;
                      })()}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-stone-400 px-2 py-1 uppercase tracking-wider">Move to</p>
                      {lists.map((list) => (
                        <Button
                          key={list.id}
                          variant={note.list_id === list.id ? "secondary" : "ghost"}
                          size="sm"
                          className="w-full justify-start rounded-lg"
                          onClick={async () => {
                            await updateNote(note.id, { list_id: list.id });
                            toast.success(`Moved to ${list.name}!`);
                          }}
                        >

                          {list.name}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Due Date Chip */}
                <DueDateChip 
                  dueDate={note.dueDate}
                  isOverdue={!!isOverdue}
                  onUpdate={async (newDate) => {
                    await updateNote(note.id, { dueDate: newDate });
                    toast.success(newDate ? "Due date updated!" : "Due date cleared!");
                  }}
                />

                {/* Owner Chip */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="meta-chip whitespace-nowrap hover:bg-stone-100 transition-colors">
                      👤 {note.task_owner || "Unassigned"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-stone-400 px-2 py-1 uppercase tracking-wider">Assign to</p>
                      <Button
                        variant={!note.task_owner ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-start rounded-lg"
                        onClick={async () => {
                          await updateNote(note.id, { task_owner: null });
                          toast.success("Owner cleared!");
                        }}
                      >
                        Unassigned
                      </Button>
                      {availableOwners.map((owner) => (
                        <Button
                          key={owner.id}
                          variant={note.task_owner === owner.name ? "secondary" : "ghost"}
                          size="sm"
                          className="w-full justify-start rounded-lg"
                          onClick={async () => {
                            await updateNote(note.id, { task_owner: owner.name });
                            toast.success("Owner updated!");
                          }}
                        >
                          {owner.name} {owner.isCurrentUser ? "(You)" : ""}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Priority Chip */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={cn("meta-chip whitespace-nowrap hover:bg-stone-100 transition-colors", priorityConfig.text)}>
                      {note.priority === 'high' ? '🔥' : note.priority === 'medium' ? '⚡' : '🟢'} {priorityConfig.label}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-stone-400 px-2 py-1 uppercase tracking-wider">Set priority</p>
                      {([
                        { value: 'high', label: 'High', emoji: '🔥' },
                        { value: 'medium', label: 'Medium', emoji: '⚡' },
                        { value: 'low', label: 'Low', emoji: '🟢' },
                      ] as const).map((p) => (
                        <Button
                          key={p.value}
                          variant={note.priority === p.value ? "secondary" : "ghost"}
                          size="sm"
                          className="w-full justify-start rounded-lg"
                          onClick={async () => {
                            await updateNote(note.id, { priority: p.value });
                            toast.success(`Priority set to ${p.label}!`);
                          }}
                        >
                          {p.emoji} {p.label}
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Reminder Chip */}
                <button 
                  className="meta-chip whitespace-nowrap hover:bg-stone-100 transition-colors"
                  onClick={() => setShowReminderDialog(true)}
                >
                  🔔 {note.reminder_time ? format(new Date(note.reminder_time), "MMM d, h:mm a") : "No reminder"}
                </button>

                {/* Privacy Chip - Simplified */}
                <div className="meta-chip whitespace-nowrap">
                  <NotePrivacyToggle note={note} size="sm" variant="ghost" />
                </div>

                {/* Status Badges */}
                {isOverdue && (
                  <span className="meta-chip bg-[hsl(var(--priority-high))]/10 text-[hsl(var(--priority-high))] whitespace-nowrap">
                    ⚠️ Overdue
                  </span>
                )}
                {note.completed && (
                  <span className="meta-chip bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] whitespace-nowrap">
                    ✓ Completed
                  </span>
                )}
              </>
            )}
          </div>

          {/* Action Buttons - Glass Style */}
          {!note.completed && (
            <div className="flex flex-col gap-3 animate-fade-up" style={{ animationDelay: '150ms' }}>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Button 
                    variant="accent"
                    size="lg" 
                    className="w-full rounded-full shadow-lg"
                    onClick={() => {
                      askOliveOnboarding.dismiss();
                      setChatOpen(true);
                    }}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {t('askOlive')}
                  </Button>
                  <OnboardingTooltip
                    isVisible={askOliveOnboarding.isVisible}
                    onDismiss={askOliveOnboarding.dismiss}
                    title={t('askOliveChat.onboarding.title')}
                    description={t('askOliveChat.onboarding.description')}
                    position="bottom"
                  />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1 rounded-full border-[hsl(var(--success))]/30 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10"
                  onClick={async () => {
                    await updateNote(note.id, { completed: true });
                    toast.success(t('toast.markedComplete'));
                    navigate(getLocalizedPath(note.list_id ? `/lists/${note.list_id}` : "/home"));
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {t('complete')}
                </Button>
              </div>
              {/* Add to Calendar & Tasks pills */}
              {calendarConnection?.connected && (
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1 rounded-full"
                    onClick={() => setCalendarDialogOpen(true)}
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    Add to Calendar
                  </Button>
                  {calendarConnection.tasks_enabled && (
                    <Button
                      variant="outline"
                      size="lg"
                      className="flex-1 rounded-full"
                      onClick={() => setTasksDialogOpen(true)}
                    >
                      <ListTodo className="h-4 w-4 mr-2" />
                      Add to Google Tasks
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Olive Tips Section - Magic Gradient Banner */}
          <div className="animate-fade-up" style={{ animationDelay: '175ms' }}>
            <OliveTipsSection note={note} />
          </div>

          {/* Tags Section - Only show if tags exist */}
          {note.tags && note.tags.length > 0 && (
            <div className="card-glass p-5 animate-fade-up" style={{ animationDelay: '200ms' }}>
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-stone-700">Tags</span>
              </div>
              {isEditing ? (
                <input
                  type="text"
                  value={editedNote.tags}
                  onChange={(e) => setEditedNote(prev => ({ ...prev, tags: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg border-stone-200 text-sm bg-white"
                  placeholder="Enter tags separated by commas"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag, index) => (
                    <span key={index} className="meta-chip text-xs">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Items/Subtasks - Only show if items exist */}
          {note.items && note.items.length > 0 && (
            <div className="card-glass p-5 animate-fade-up" style={{ animationDelay: '250ms' }}>
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-stone-700">Details</span>
              </div>
              {isEditing ? (
                <Textarea
                  value={editedNote.items}
                  onChange={(e) => setEditedNote(prev => ({ ...prev, items: e.target.value }))}
                  className="min-h-[100px] text-sm border-stone-200 bg-white"
                  placeholder="Enter items, one per line"
                />
              ) : (
                <div className="space-y-2">
                  {note.items.map((item, index) => {
                    const parsed = parseItem(item);
                    return (
                      <div 
                        key={index} 
                        className="flex items-start gap-3 py-2.5 border-b border-stone-100 last:border-0 group"
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {parsed.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          {parsed.label ? (
                            <div>
                              <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">
                                {parsed.label}
                              </span>
                              <p className="text-sm text-stone-700 mt-0.5">
                                {parsed.isLink ? (
                                  <a 
                                    href={parsed.value} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline break-all"
                                  >
                                    {parsed.value}
                                  </a>
                                ) : (
                                  renderTextWithLinks(parsed.value)
                                )}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-stone-700">
                              {parsed.isLink ? (
                                <a 
                                  href={parsed.value} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline break-all"
                                >
                                  {parsed.value}
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
              )}
            </div>
          )}

          {/* Add Subtask Button - Show when no items */}
          {(!note.items || note.items.length === 0) && !isEditing && (
            isAddingItems ? (
              <div className="card-glass p-5 animate-fade-up">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-stone-700">Details</span>
                </div>
                <Textarea
                  autoFocus
                  value={newItems}
                  onChange={(e) => setNewItems(e.target.value)}
                  className="min-h-[100px] text-sm border-stone-200 bg-white mb-3"
                  placeholder="Enter details or subtasks, one per line"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setIsAddingItems(false); setNewItems(""); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={async () => {
                    const items = newItems.split("\n").map(i => i.trim()).filter(Boolean);
                    if (items.length > 0) {
                      await updateNote(note.id, { items });
                      toast.success(t('toast.noteUpdated'));
                    }
                    setIsAddingItems(false);
                    setNewItems("");
                  }}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setIsAddingItems(true)}
                className="w-full py-3 text-sm text-stone-400 hover:text-stone-600 transition-colors flex items-center justify-center gap-2"
              >
                <span>+ Add details or subtasks</span>
              </button>
            )
          )}

          {/* Media Section */}
          <div className="animate-fade-up" style={{ animationDelay: '300ms' }}>
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

      {/* Calendar Dialog */}
      {note && (
        <AddToCalendarDialog
          note={note}
          open={calendarDialogOpen}
          onOpenChange={setCalendarDialogOpen}
        />
      )}

      {/* Google Tasks Dialog */}
      {note && (
        <AddToGoogleTasksDialog
          note={note}
          open={tasksDialogOpen}
          onOpenChange={setTasksDialogOpen}
        />
      )}
    </main>
  );
};

export default NoteDetails;
