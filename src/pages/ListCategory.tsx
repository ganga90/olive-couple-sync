import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useNotes } from "@/providers/NotesProvider";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const ListCategory = () => {
  const { category = "" } = useParams();
  const navigate = useNavigate();
  const { getNotesByCategory } = useNotes();
  const decoded = decodeURIComponent(category);
  const notes = useMemo(() => getNotesByCategory(decoded), [decoded, getNotesByCategory]);

  useSEO({ title: `${decoded} — Olive`, description: `Browse items in ${decoded} list.` });

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold">{decoded}</h1>
      </header>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items yet in this list.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <Link key={n.id} to={`/notes/${n.id}`} className="block" aria-label={`Open ${n.summary}`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <div className="mb-1 text-sm font-medium">{n.summary}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{n.category}</Badge>
                      {n.dueDate ? <span>Due {new Date(n.dueDate).toLocaleDateString()}</span> : null}
                    </div>
                  </div>
                  <span className="text-muted-foreground">›</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
};

export default ListCategory;
