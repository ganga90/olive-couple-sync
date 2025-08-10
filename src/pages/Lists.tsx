import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotes } from "@/providers/NotesProvider";
import { Button } from "@/components/ui/button";
import { useSEO } from "@/hooks/useSEO";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categories } from "@/constants/categories";

const Lists = () => {
  
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  
  const { notes, isLoading, updateNote, deleteNote } = useNotes();
  useSEO({ title: "Lists — Olive", description: "Browse and search all your lists." });

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      const matchesCategory = category === "All" || n.category === category;
      const matchesQuery =
        !q ||
        n.summary.toLowerCase().includes(q) ||
        n.originalText.toLowerCase().includes(q) ||
        (n.tags?.some((t) => t.toLowerCase().includes(q)) ?? false);
      return matchesCategory && matchesQuery;
    });
  }, [notes, query, category]);


  return (
    <main className="mx-auto max-w-2xl px-4 py-8">

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">All lists</h2>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes by text or tags"
              aria-label="Search notes"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet. Add one from Home to get started.</p>
        ) : filteredNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching notes. Try a different search or category.</p>
        ) : (
          <div className="space-y-3">
            {filteredNotes.map((n) => (
              <Card key={n.id} className="border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
                  <CardTitle className="text-base font-medium">{n.summary}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{n.category}</Badge>
                    {n.dueDate ? <Badge variant="outline">Due {format(new Date(n.dueDate), "MMM d")}</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 py-3">
                  <div className="flex items-center justify-between">
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
                  </div>

                  <div className="space-y-2">
                    {n.items && n.items.length ? (
                      <ul className="list-disc pl-6 text-sm text-muted-foreground">
                        {n.items.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    ) : null}

                    <p className="text-sm text-muted-foreground">{n.originalText}</p>

                    <div className="flex flex-wrap items-center gap-2">
                      {n.tags?.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                      {n.priority ? <Badge variant="secondary">{n.priority}</Badge> : null}
                      <span className="ml-auto text-xs text-muted-foreground">
                        Added by {n.addedBy} • {format(new Date(n.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: notes.map((n, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: n.summary,
              description: n.originalText,
              dateCreated: n.createdAt,
              dateModified: n.updatedAt,
            })),
          }),
        }}
      />
    </main>
  );
};

export default Lists;
