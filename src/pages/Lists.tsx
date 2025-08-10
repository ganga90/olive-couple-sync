import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useUser } from "@clerk/clerk-react";
import { useNotes } from "@/providers/NotesProvider";
import { processNoteWithAI } from "@/utils/aiProcessor";
import { useSEO } from "@/hooks/useSEO";
import { format } from "date-fns";

const Lists = () => {
  const [note, setNote] = useState("");
  const { user } = useUser();
  const { notes, isLoading, addNote, updateNote, deleteNote } = useNotes();
  useSEO({ title: "Lists — Olive", description: "Capture and organize shared notes for your couple." });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    const addedBy = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "You";
    try {
      const processed = await processNoteWithAI(text, addedBy);
      addNote(processed);
      toast.success("Note captured and organized.");
      setNote("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to process note.");
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <section className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold">Drop a note</h1>
        <p className="mb-4 text-sm text-muted-foreground">Write anything. Olive will summarize, categorize, and schedule it.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Buy lemons tomorrow and book dental checkup" />
          <div className="flex justify-end">
            <Button type="submit">Add</Button>
          </div>
        </form>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">Your notes</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet. Add one above to get started.</p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <Card key={n.id} className="border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                  <CardTitle className="text-base font-medium">
                    {n.summary}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{n.category}</Badge>
                    {n.dueDate ? (
                      <Badge variant="outline">Due {format(new Date(n.dueDate), "MMM d")}</Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Checkbox id={`done-${n.id}`} checked={n.completed} onCheckedChange={() => updateNote(n.id, { completed: !n.completed })} />
                    <label htmlFor={`done-${n.id}`} className="text-sm text-muted-foreground">
                      Mark done
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => deleteNote(n.id)}>
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xl font-semibold">Common lists</h2>
        <p className="text-sm text-muted-foreground">Groceries, tasks, travel ideas, date ideas — coming next.</p>
      </section>
    </main>
  );
};

export default Lists;
