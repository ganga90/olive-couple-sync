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
import { generateOliveReply } from "@/utils/oliveAssistant";

const NoteDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notes, deleteNote } = useNotes();
  const note = useMemo(() => notes.find((n) => n.id === id), [notes, id]);

  useSEO({ title: note ? `${note.summary} — Olive` : "Note — Olive", description: note?.originalText });

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "assistant" | "user"; content: string }[]>(
    note
      ? [
          { role: "assistant", content: `Hi! How can I help with “${note.summary}”?` },
        ]
      : []
  );
  const [input, setInput] = useState("");

  if (!note) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <p className="text-sm text-muted-foreground">Note not found.</p>
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
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const reply = await generateOliveReply(note, text);
    setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold">Note Details</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Edit note" onClick={() => toast.message("Edit coming soon") }>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Delete note" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{note.category}</Badge>
        </div>

        <h2 className="text-2xl font-semibold leading-tight">{note.summary}</h2>

        <Card>
          <CardContent className="p-4">
            <div className="mb-1 text-xs font-medium text-muted-foreground">ORIGINAL NOTE:</div>
            <p className="rounded-md bg-secondary p-3 text-sm">{note.originalText}</p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2"><User className="h-4 w-4" /> Added by {note.addedBy}</div>
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Created {format(new Date(note.createdAt), "M/d/yyyy")}</div>
        </div>

        <Separator />

        <Button size="lg" className="w-full" onClick={() => setChatOpen(true)}>
          <span role="img" aria-label="olive" className="mr-2">🫒</span>
          Ask Olive for help
        </Button>
      </section>

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Olive Assistant</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-md bg-muted/40 p-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={
                  m.role === "user"
                    ? "inline-block rounded-lg bg-primary text-primary-foreground px-3 py-2"
                    : "inline-block rounded-lg bg-secondary px-3 py-2"
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
            />
            <DialogFooter>
              <Button onClick={onSend}>Send</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default NoteDetails;
