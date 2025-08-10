import { useState } from "react";
import { SignedIn, SignedOut, SignIn, useUser } from "@clerk/clerk-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { toast } from "sonner";
import { useNotes } from "@/providers/NotesProvider";
import { processNoteWithAI } from "@/utils/aiProcessor";
import { formatDistanceToNow } from "date-fns";

const Index = () => {
  useSEO({ title: "Home — Olive", description: "Capture notes and see your latest items in Olive." });
  const [note, setNote] = useState("");
  const { user } = useUser();
  const { notes, addNote } = useNotes();
  const latestNotes = notes
    .slice()
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .slice(0, 5);
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
    <main className="min-h-screen bg-background">
      <section className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 px-4 py-20 text-center">
        <h1 className="text-4xl font-bold">Olive — your couple’s second brain</h1>
        <p className="text-lg text-muted-foreground">Capture anything in one place. Olive organizes it for both of you.</p>
        <SignedOut>
          <div className="w-full max-w-md rounded-md border p-4">
            <SignIn fallbackRedirectUrl="/onboarding" />
          </div>
        </SignedOut>
        <SignedIn>
          <div className="w-full space-y-6">
            <section aria-labelledby="drop-a-note">
              <h2 id="drop-a-note" className="mb-2 text-xl font-semibold">Drop a note</h2>
              <p className="mb-3 text-sm text-muted-foreground">Write anything. Olive will summarize, categorize, and schedule it.</p>
              <form onSubmit={onSubmit} className="space-y-3">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., Buy lemons tomorrow and book dental checkup"
                  aria-label="Add a note"
                />
                <div className="flex justify-center">
                  <Button type="submit">Add note</Button>
                </div>
              </form>
            </section>

            <section aria-labelledby="latest-notes">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="latest-notes" className="text-xl font-semibold">Latest notes</h2>
                <Link to="/lists" className="text-sm text-muted-foreground hover:text-foreground">View all</Link>
              </div>

              {latestNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet. Add your first note above.</p>
              ) : (
                <div className="grid gap-3">
                  {latestNotes.map((n) => (
                    <article key={n.id}>
                      <Link to={`/notes/${n.id}`} aria-label={`Open note ${n.summary}`}>
                        <Card className="transition-colors hover:bg-accent/50">
                          <CardContent className="p-4">
                            <div className="mb-1 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">{n.category}</Badge>
                                {n.dueDate ? (
                                  <Badge variant="outline">Due {new Date(n.dueDate).toLocaleDateString()}</Badge>
                                ) : null}
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                              </span>
                            </div>
                            <p className="text-sm">{n.summary}</p>
                            {n.addedBy ? (
                              <p className="mt-2 text-xs text-muted-foreground">Added by {n.addedBy}</p>
                            ) : null}
                          </CardContent>
                        </Card>
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </SignedIn>
      </section>
    </main>
  );
};

export default Index;
