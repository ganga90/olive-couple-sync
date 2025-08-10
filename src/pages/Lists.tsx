import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useNotes } from "@/providers/NotesProvider";
import { useSEO } from "@/hooks/useSEO";
import { Input } from "@/components/ui/input";
import { categories } from "@/constants/categories";

const Lists = () => {
  
  const [query, setQuery] = useState("");
  
  
  const { notes, isLoading } = useNotes();
  useSEO({ title: "Lists — Olive", description: "Browse and search all your lists." });

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories.filter((c) => !q || c.toLowerCase().includes(q));
  }, [query]);


  return (
    <main className="mx-auto max-w-2xl px-4 py-8">

      <section className="mb-10">
        <h1 className="mb-3 text-2xl font-semibold">Lists</h1>

        <div className="mb-4 flex flex-col gap-3">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lists..."
              aria-label="Search lists"
            />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : filteredCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lists found.</p>
        ) : (
          <div className="space-y-3">
            {filteredCategories.map((c) => {
              const count = notes.filter((n) => n.category === c).length;
              return (
                <Card key={c} className="border-border bg-card/90 shadow-sm">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-foreground/80">
                        {/* Icon placeholder per category (simple emoji for now) */}
                        <span aria-hidden>🗂️</span>
                      </div>
                      <div>
                        <div className="font-medium">{c}</div>
                        <div className="text-xs text-muted-foreground">{count} {count === 1 ? "item" : "items"}</div>
                      </div>
                    </div>
                    <span className="text-muted-foreground">›</span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

    </main>
  );
};

export default Lists;
