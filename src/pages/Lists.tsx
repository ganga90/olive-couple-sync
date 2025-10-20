import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSEO } from "@/hooks/useSEO";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { CreateListDialog } from "@/components/CreateListDialog";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { useAuth } from "@/providers/AuthProvider";
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
  UtensilsCrossed,
  List as ListIcon,
  Pencil,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, any> = {
    'groceries': ShoppingCart,
    'grocery': ShoppingCart,
    'task': CheckSquare,
    'tasks': CheckSquare,
    'home improvement': Home,
    'home': Home,
    'travel idea': Plane,
    'travel': Plane,
    'date idea': Heart,
    'date': Heart,
    'shopping': ShoppingBag,
    'health': Activity,
    'finance': DollarSign,
    'work': Briefcase,
    'personal': User,
    'gift ideas': Gift,
    'gifts': Gift,
    'recipes': ChefHat,
    'recipe': ChefHat,
    'movies to watch': Film,
    'movies': Film,
    'books to read': Book,
    'books': Book,
    'restaurants': UtensilsCrossed,
    'restaurant': UtensilsCrossed,
  };
  
  const normalizedCategory = category.toLowerCase();
  return iconMap[normalizedCategory] || ListIcon;
};

const Lists = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState("");
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists, loading, deleteList, refetch } = useSupabaseLists(currentCouple?.id || null);
  
  useSEO({ title: "Lists — Olive", description: "Browse and manage all your lists." });

  const filteredLists = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    if (!q) {
      return lists;
    }

    // Filter lists based on search criteria
    return lists.filter(list => {
      // Search in list name
      if (list.name.toLowerCase().includes(q)) return true;
      
      // Search in list description
      if (list.description && list.description.toLowerCase().includes(q)) return true;
      
      return false;
    });
  }, [query, lists]);

  const getListNoteCount = (listId: string) => {
    return notes.filter(note => note.list_id === listId && !note.completed).length;
  };

  const handleDeleteList = async (listId: string, listName: string) => {
    if (window.confirm(`Are you sure you want to delete the "${listName}" list? This action cannot be undone.`)) {
      await deleteList(listId);
      refetch();
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center space-y-4">
            <ListIcon className="h-16 w-16 mx-auto text-olive" />
            <h1 className="text-2xl font-bold text-foreground">Lists</h1>
            <p className="text-muted-foreground">Sign in to create new lists or manage your lists</p>
            <Button onClick={() => navigate("/sign-in")} className="bg-gradient-olive text-white">
              Sign In
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <FloatingActionButton />
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-olive-dark">Lists</h1>
          <CreateListDialog onListCreated={refetch} />
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

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : filteredLists.length === 0 ? (
          <Card className="p-8 bg-white/50 border-olive/20 shadow-soft text-center">
            <ListIcon className="h-12 w-12 text-olive/50 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              {query ? "No lists match your search." : "No lists yet. Create your first list to get organized!"}
            </p>
            {!query && <CreateListDialog onListCreated={refetch} />}
          </Card>
        ) : (
          <div className="space-y-3">
             {filteredLists.map((list) => {
               const count = getListNoteCount(list.id);
               const ListIconComponent = getCategoryIcon(list.name);
               return (
                <Card key={list.id} className="bg-white/50 border-olive/20 shadow-[var(--shadow-raised)] transition-all duration-200 hover:shadow-soft group">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <Link 
                        to={`/lists/${encodeURIComponent(list.id)}`} 
                        aria-label={`Open ${list.name} list`}
                        className="flex items-center gap-3 flex-1 hover:text-olive"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-olive/10 border border-olive/20">
                          <ListIconComponent className="h-5 w-5 text-olive" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-olive-dark flex items-center gap-2">
                            {list.name}
                            {!list.is_manual && (
                              <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">
                                Auto
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {count} {count === 1 ? "item" : "items"}
                            {list.description && (
                              <span className="ml-2">• {list.description}</span>
                            )}
                          </div>
                        </div>
                        <span className="text-olive">›</span>
                      </Link>
                      
                      {/* Action buttons - only show for manual lists */}
                      {list.is_manual && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // TODO: Add edit list functionality
                              toast.info("Edit functionality coming soon!");
                            }}
                            className="h-8 w-8 p-0 hover:bg-olive/10"
                          >
                            <Pencil className="h-3 w-3 text-olive" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteList(list.id, list.name);
                            }}
                            className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
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