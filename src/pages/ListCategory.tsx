import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

const ListCategory = () => {
  const { category = "" } = useParams();
  const navigate = useNavigate();
  const { notes } = useSupabaseNotesContext();
  const decoded = decodeURIComponent(category);
  const categoryNotes = useMemo(() => 
    notes.filter(note => note.category === decoded), 
    [notes, decoded]
  );

  useSEO({ title: `${decoded} — Olive`, description: `Browse items in ${decoded} list.` });

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center gap-3">
          <Button 
            variant="ghost" 
            onClick={() => navigate(-1)} 
            aria-label="Go back"
            className="hover:bg-olive/10 hover:text-olive"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold text-olive-dark">{decoded}</h1>
        </header>

        {categoryNotes.length === 0 ? (
          <Card className="p-6 bg-white/50 border-olive/20 shadow-soft text-center">
            <p className="text-sm text-muted-foreground">No items yet in this list.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {categoryNotes.map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`} className="block" aria-label={`Open ${n.summary}`}>
                <Card className="bg-white/50 border-olive/20 shadow-soft transition-all duration-200 hover:shadow-lg hover:scale-[1.02]">
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <div className="mb-1 text-sm font-medium text-olive-dark">{n.summary}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20">
                          {n.category}
                        </Badge>
                        {n.dueDate ? <span>Due {new Date(n.dueDate).toLocaleDateString()}</span> : null}
                      </div>
                    </div>
                    <span className="text-olive">›</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export default ListCategory;
