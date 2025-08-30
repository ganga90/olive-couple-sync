import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseCouples } from "@/hooks/useSupabaseCouples";
import { getSupabase } from "@/lib/supabaseClient";
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
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, User, CalendarDays, CheckCircle, Tag, UserCheck, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { assistWithNote } from "@/utils/oliveAssistant";
import { OliveLogo } from "@/components/OliveLogo";
import ReactMarkdown from 'react-markdown';
import { cn } from "@/lib/utils";

const NoteDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useUser();
  const { notes, deleteNote, updateNote } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouples();
  const supabase = getSupabase();
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
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [localTaskOwner, setLocalTaskOwner] = useState<string | null>(note?.task_owner || null);
  const [isEditingDueDate, setIsEditingDueDate] = useState(false);
  const [localDueDate, setLocalDueDate] = useState<Date | undefined>(
    note?.dueDate ? new Date(note.dueDate) : undefined
  );

  // Sync localTaskOwner with note.task_owner when note changes
  useEffect(() => {
    if (note) {
      setLocalTaskOwner(note.task_owner || null);
      setLocalDueDate(note.dueDate ? new Date(note.dueDate) : undefined);
    }
  }, [note?.task_owner, note?.dueDate]);

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

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-6">
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
            <Button 
              variant="outline" 
              size="icon" 
              aria-label="Edit note" 
              onClick={() => toast.message("Edit coming soon")}
              className="border-olive/30 hover:bg-olive/10 hover:text-olive"
            >
              <Pencil className="h-4 w-4" />
            </Button>
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
            <h2 className="text-2xl font-semibold leading-tight text-olive-dark">{note.summary}</h2>
          </div>

          {/* Category and Priority */}
          <div className="flex items-center gap-3 flex-wrap">
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

          {/* Tags Section */}
          {note.tags && note.tags.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Tag className="h-4 w-4" />
                <span>Tags</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {note.tags.map((tag, idx) => (
                  <Badge key={idx} variant="outline" className="bg-gray-50 border-gray-200 text-gray-600">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Items List */}
          {note.items && note.items.length > 0 && (
            <Card className="bg-white/50 border-olive/20 shadow-soft">
              <CardContent className="p-4">
                <div className="mb-3 text-xs font-medium text-olive-dark uppercase tracking-wide">Items</div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-olive-dark">
                  {note.items.map((it, idx) => (
                    <li key={idx}>{it}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Task Owner Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-olive-dark">
                  <UserCheck className="h-4 w-4 text-olive" />
                  <span>Task Owner</span>
                </div>
                {!isEditingOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingOwner(true)}
                    className="text-olive hover:bg-olive/10"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="mt-2">
                {isEditingOwner ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={localTaskOwner || "none"}
                      onValueChange={(value) => updateTaskOwner(value)}
                    >
                      <SelectTrigger className="flex-1 border-olive/30 focus:border-olive focus:ring-olive/20 bg-white">
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingOwner(false)}
                      className="border-olive/30"
                    >
                      Done
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {localTaskOwner || "No owner assigned"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Due Date Section */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-olive-dark">
                  <CalendarIcon className="h-4 w-4 text-olive" />
                  <span>Due Date</span>
                </div>
                {!isEditingDueDate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditingDueDate(true)}
                    className="text-olive hover:bg-olive/10"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <div className="mt-2">
                {isEditingDueDate ? (
                  <div className="flex items-center gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "flex-1 justify-start text-left font-normal border-olive/30 focus:border-olive",
                            !localDueDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {localDueDate ? format(localDueDate, "PPP") : <span>Pick a date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={localDueDate}
                          onSelect={(date) => updateDueDate(date)}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        updateDueDate(undefined);
                      }}
                      className="border-olive/30 text-red-600 hover:bg-red-50"
                    >
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingDueDate(false)}
                      className="border-olive/30"
                    >
                      Done
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {localDueDate ? format(localDueDate, "PPP") : "No due date set"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-olive" /> 
              <span>Added by {note.addedBy || 'You'}</span>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-olive" /> 
              <span>{format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
          </div>

          {/* Original Text */}
          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="mb-3 text-xs font-medium text-olive-dark uppercase tracking-wide">Original</div>
              <p className="text-sm text-muted-foreground italic">"{note.originalText}"</p>
            </CardContent>
          </Card>

          <Separator className="my-6 bg-olive/20" />

          <Button 
            size="lg" 
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            onClick={() => setChatOpen(true)}
          >
            <OliveLogo size={20} className="mr-2" />
            Ask Olive for help
          </Button>
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
    </main>
  );
};

export default NoteDetails;