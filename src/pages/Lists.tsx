import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSEO } from "@/hooks/useSEO";
import { Input } from "@/components/ui/input";
import { categories } from "@/constants/categories";
import { Link } from "react-router-dom";
import { 
  ShoppingCart, 
  CheckSquare, 
  Home, 
  Plane, 
  Heart, 
  ShoppingBag, 
  Activity, 
  DollarSign, 
  Briefcase, 
  User, 
  Gift, 
  ChefHat, 
  Film, 
  Book, 
  UtensilsCrossed 
} from "lucide-react";

const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, any> = {
    'groceries': ShoppingCart,
    'task': CheckSquare,
    'home improvement': Home,
    'travel idea': Plane,
    'date idea': Heart,
    'shopping': ShoppingBag,
    'health': Activity,
    'finance': DollarSign,
    'work': Briefcase,
    'personal': User,
    'gift ideas': Gift,
    'recipes': ChefHat,
    'movies to watch': Film,
    'books to read': Book,
    'restaurants': UtensilsCrossed,
  };
  
  const normalizedCategory = category.toLowerCase();
  return iconMap[normalizedCategory] || User;
};

const Lists = () => {
  const [query, setQuery] = useState("");
  const { notes, loading, refetch } = useSupabaseNotesContext();
  useSEO({ title: "Lists — Olive", description: "Browse and search all your lists." });

  // Refresh data when the page loads
  useEffect(() => {
    refetch();
  }, [refetch]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    if (!q) {
      // If no search query, show all categories that have notes
      return Array.from(new Set(notes.map(note => note.category)));
    }

    // Filter notes based on search criteria
    const matchingNotes = notes.filter(note => {
      // Search in category name
      if (note.category.toLowerCase().includes(q)) return true;
      
      // Search in task summary (task name)
      if (note.summary.toLowerCase().includes(q)) return true;
      
      // Search in original text
      if (note.originalText.toLowerCase().includes(q)) return true;
      
      // Search in tags
      if (note.tags && note.tags.some(tag => tag.toLowerCase().includes(q))) return true;
      
      // Search in task owner
      if (note.task_owner && note.task_owner.toLowerCase().includes(q)) return true;
      
      // Search in added by
      if (note.addedBy && note.addedBy.toLowerCase().includes(q)) return true;
      
      return false;
    });

    // Get unique categories from matching notes
    return Array.from(new Set(matchingNotes.map(note => note.category)));
  }, [query, notes]);

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-3 text-2xl font-semibold text-olive-dark">Lists</h1>

        <div className="mb-6">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in lists, tasks, tags, owners..."
            aria-label="Search lists"
            className="border-olive/30 focus:border-olive focus:ring-olive/20 bg-white/50"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : filteredCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lists found.</p>
        ) : (
          <div className="space-y-3">
             {filteredCategories.map((c) => {
               const count = notes.filter((n) => n.category === c).length;
               const CategoryIcon = getCategoryIcon(c);
               return (
                <Link key={c} to={`/lists/${encodeURIComponent(c)}`} aria-label={`Open ${c} list`} className="block">
                  <Card className="bg-white/50 border-olive/20 shadow-soft transition-all duration-200 hover:shadow-lg hover:scale-[1.02]">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-olive/10 border border-olive/20">
                          <CategoryIcon className="h-5 w-5 text-olive" />
                        </div>
                        <div>
                          <div className="font-medium text-olive-dark">{c}</div>
                          <div className="text-xs text-muted-foreground">{count} {count === 1 ? "item" : "items"}</div>
                        </div>
                      </div>
                      <span className="text-olive">›</span>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
};

export default Lists;
