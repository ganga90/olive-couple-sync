import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseListsContext } from "@/providers/SupabaseListsProvider";
import { useSEO } from "@/hooks/useSEO";
import { Input } from "@/components/ui/input";
import { CreateListDialog } from "@/components/CreateListDialog";
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
  const { lists, loading: listsLoading, refetch: refetchLists } = useSupabaseListsContext();
  useSEO({ title: "Lists — Olive", description: "Browse and search all your lists." });

  // Refresh data when the page loads
  useEffect(() => {
    refetch();
    refetchLists();
  }, [refetch, refetchLists]);

  const filteredLists = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    // Filter lists based on search query
    const matchingLists = lists.filter(list => {
      const matchesQuery = !q || list.name.toLowerCase().includes(q);
      return matchesQuery;
    });
    
    return matchingLists;
  }, [query, lists]);

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-olive-dark">Lists</h1>
          <CreateListDialog />
        </div>

        <div className="mb-6">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists..."
            aria-label="Search lists"
            className="border-olive/30 focus:border-olive focus:ring-olive/20 bg-white/50"
          />
        </div>

        {loading || listsLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : filteredLists.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">No lists found.</p>
            <CreateListDialog />
          </div>
        ) : (
          <div className="space-y-3">
             {filteredLists.map((list) => {
               const count = notes.filter((n) => n.category === list.name).length;
               const CategoryIcon = getCategoryIcon(list.name);
               return (
                <Link key={list.id} to={`/lists/${encodeURIComponent(list.name)}`} aria-label={`Open ${list.name} list`} className="block">
                  <Card className="bg-white/50 border-olive/20 shadow-soft transition-all duration-200 hover:shadow-lg hover:scale-[1.02]">
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-olive/10 border border-olive/20">
                          <CategoryIcon className="h-5 w-5 text-olive" />
                        </div>
                        <div>
                          <div className="font-medium text-olive-dark">{list.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {count} {count === 1 ? "item" : "items"}
                            {list.is_manual && <span className="ml-2 text-olive">• Manual</span>}
                          </div>
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
