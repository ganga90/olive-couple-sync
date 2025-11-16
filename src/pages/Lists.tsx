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
  ChevronRight,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <ListIcon className="h-16 w-16 text-primary mb-4" />
        <h1 className="text-2xl font-semibold mb-2">Lists</h1>
        <p className="text-muted-foreground mb-6">Sign in to manage your lists</p>
        <Button onClick={() => navigate("/sign-in")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-6">
      <div className="px-4 pt-6 space-y-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Lists</h1>
          <CreateListDialog onListCreated={refetch} />
        </div>

        {/* Search */}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lists..."
          className="rounded-[var(--radius-lg)] border-border/50 focus:border-primary"
        />

        {/* Lists */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3"></div>
            <p className="text-sm text-muted-foreground">Loading lists...</p>
          </div>
        ) : filteredLists.length === 0 ? (
          <Card className="shadow-[var(--shadow-card)] border-border/50">
            <CardContent className="p-8 text-center">
              <ListIcon className="h-14 w-14 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                {query ? "No lists match your search." : "No lists yet. Create your first list!"}
              </p>
              {!query && <CreateListDialog onListCreated={refetch} />}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredLists.map((list) => {
              const count = getListNoteCount(list.id);
              const ListIconComponent = getCategoryIcon(list.name);
              return (
                <Card 
                  key={list.id} 
                  className="shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-raised)] transition-all duration-200 group border-border/50"
                >
                  <CardContent className="p-0">
                    <Link 
                      to={`/lists/${encodeURIComponent(list.id)}`}
                      className="flex items-center gap-3 p-3 md:p-4 w-full active:scale-[0.98] transition-transform"
                    >
                      {/* Icon */}
                      <div className="flex h-10 w-10 md:h-12 md:w-12 flex-shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary/10">
                        <ListIconComponent className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-semibold text-sm md:text-base text-foreground truncate">
                            {list.name}
                          </h3>
                          {!list.is_manual && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-accent/80 text-accent-foreground">
                              AI
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {count} {count === 1 ? "item" : "items"}
                          {list.description && ` • ${list.description}`}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {list.is_manual && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteList(list.id, list.name);
                            }}
                            className="md:opacity-0 md:group-hover:opacity-100 transition-opacity p-2 hover:bg-destructive/10 rounded-[var(--radius-sm)]"
                            aria-label="Delete list"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        )}
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Lists;