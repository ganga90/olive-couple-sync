import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useNotes } from "@/providers/NotesProvider";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, User, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { assistWithNote } from "@/utils/oliveAssistant";
import { OliveLogo } from "@/components/OliveLogo";

const NoteDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notes, deleteNote, updateNote } = useNotes();
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

  const onDelete = () => {
    deleteNote(note.id);
    toast.success("Note deleted");
    navigate(-1);
  };

  const onSend = async () => {
    const text = input.trim();
    if (!text || !note) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const { reply, updates } = await assistWithNote(note, text);
    if (updates && Object.keys(updates).length) {
      updateNote(note.id, updates);
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
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

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20">
              {note.category}
            </Badge>
          </div>

          <h2 className="text-2xl font-semibold leading-tight text-olive-dark">{note.summary}</h2>

          {note.items && note.items.length ? (
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
          ) : null}

          <Card className="bg-white/50 border-olive/20 shadow-soft">
            <CardContent className="p-4">
              <div className="mb-3 text-xs font-medium text-olive-dark uppercase tracking-wide">Original Note</div>
              <p className="rounded-md bg-olive/5 border border-olive/10 p-3 text-sm text-olive-dark">{note.originalText}</p>
            </CardContent>
          </Card>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-olive" /> 
              <span>Added by {note.addedBy}</span>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-olive" /> 
              <span>Created {format(new Date(note.createdAt), "M/d/yyyy")}</span>
            </div>
          </div>

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
                  {m.content}
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