import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const Lists = () => {
  const [note, setNote] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    toast.success("Note captured — AI will organize it soon.");
    setNote("");
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

      <section>
        <h2 className="mb-2 text-xl font-semibold">Common lists</h2>
        <p className="text-sm text-muted-foreground">Groceries, tasks, travel ideas, date ideas — coming next.</p>
      </section>
    </main>
  );
};

export default Lists;
