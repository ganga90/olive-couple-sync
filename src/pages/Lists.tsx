import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseListsContext } from "@/providers/SupabaseListsProvider";
import { useSEO } from "@/hooks/useSEO";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
  List
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
  const [createListOpen, setCreateListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const { notes, loading: notesLoading, refetch: refetchNotes } = useSupabaseNotesContext();
  const { lists, loading: listsLoading, addList, refetch: refetchLists } = useSupabaseListsContext();
  useSEO({ title: "Lists — Olive", description: "Browse and search all your lists." });

  // Refresh data when the page loads
  useEffect(() => {
    refetchNotes();
    refetchLists();
  }, [refetchNotes, refetchLists]);

  const handleCreateList = async () => {
    if (!newListName.trim()) {
      toast.error("Please enter a list name");
      return;
    }

    try {
      await addList({
        name: newListName.trim(),
        description: undefined,
        is_manual: true,
      });
      toast.success("List created successfully!");
      setCreateListOpen(false);
      setNewListName("");
    } catch (error) {
      console.error('Failed to create list:', error);
      toast.error("Failed to create list");
    }
  };

  const filteredLists = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    // Filter lists by name matching query
    return lists.filter(list => {
      const matchesQuery = !q || list.name.toLowerCase().includes(q);
      return matchesQuery;
    });
  }, [query, lists]);

  const loading = notesLoading || listsLoading;

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-olive-dark">Lists</h1>
          <Button
            onClick={() => setCreateListOpen(true)}
            className="bg-olive hover:bg-olive/90 text-white shadow-soft"
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            New List
          </Button>
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
          <div className="text-center py-8">
            <List className="h-12 w-12 text-olive/50 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No lists found.</p>
            <Button
              onClick={() => setCreateListOpen(true)}
              variant="outline"
              className="mt-3 border-olive/30 text-olive hover:bg-olive/10"
            >
              Create your first list
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
             {filteredLists.map((list) => {
               const notesInList = notes.filter((n) => n.listId === list.id);
               const count = notesInList.length;
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
                            {list.is_manual && <span className="ml-2 px-1.5 py-0.5 bg-olive/10 text-olive text-[10px] rounded">Manual</span>}
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

      <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
        <DialogContent className="bg-white border-olive/20 shadow-soft">
          <DialogHeader>
            <DialogTitle className="text-olive-dark">Create New List</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="listName" className="text-sm font-medium text-olive-dark">
                List Name
              </Label>
              <Input
                id="listName"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="e.g., Groceries, Travel Plans..."
                className="border-olive/30 focus:border-olive focus:ring-olive/20"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateList();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateListOpen(false)}
              className="border-olive/30 text-olive hover:bg-olive/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateList}
              className="bg-olive hover:bg-olive/90 text-white"
            >
              Create List
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Lists;
