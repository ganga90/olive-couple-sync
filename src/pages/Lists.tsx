import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
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
  Trash2,
  Search,
  AlertCircle,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isAfter, parseISO, addDays } from "date-fns";

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
  const { t } = useTranslation(['lists', 'common']);
  const getLocalizedPath = useLocalizedHref();
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState("");
  const { notes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists, loading, deleteList, refetch } = useSupabaseLists(currentCouple?.id || null);
  
  useSEO({ title: `${t('title')} — Olive`, description: t('empty.createFirstList') });

  const filteredLists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter(list => 
      list.name.toLowerCase().includes(q) || 
      (list.description && list.description.toLowerCase().includes(q))
    );
  }, [query, lists]);

  const getListStats = (listId: string) => {
    const listNotes = notes.filter(note => note.list_id === listId);
    const total = listNotes.length;
    const completed = listNotes.filter(n => n.completed).length;
    const active = total - completed;
    const now = new Date();
    const overdue = listNotes.filter(n => !n.completed && n.dueDate && isAfter(now, parseISO(n.dueDate))).length;
    const dueThisWeek = listNotes.filter(n => {
      if (n.completed || !n.dueDate) return false;
      const due = parseISO(n.dueDate);
      return isAfter(due, now) && isAfter(addDays(now, 7), due);
    }).length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    return { total, completed, active, overdue, dueThisWeek, progress };
  };

  const handleDeleteList = async (listId: string, listName: string) => {
    if (window.confirm(t('actions.deleteConfirm', { name: listName }))) {
      await deleteList(listId);
      refetch();
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <ListIcon className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        <p className="text-muted-foreground mb-6">{t('signInPrompt')}</p>
        <Button variant="accent" onClick={() => navigate(getLocalizedPath("/sign-in"))}>{t('buttons.signIn', { ns: 'common' })}</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-4 pt-6 pb-24 md:pb-6 space-y-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ListIcon className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t('title')}</h1>
          </div>
          <CreateListDialog onListCreated={refetch} />
        </div>

        {/* Search */}
        <div className="relative animate-fade-up" style={{ animationDelay: '50ms' }}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-10 bg-card border-border/50 focus:border-primary rounded-xl h-11"
          />
        </div>

        {/* Lists */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-32 bg-muted rounded" />
                      <div className="h-3 w-24 bg-muted rounded" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredLists.length === 0 ? (
          <Card className="shadow-card border-border/50 animate-fade-up">
            <CardContent className="p-8 text-center">
              <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <ListIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">
                {query ? t('empty.noListsFound') : t('empty.noListsYet')}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {query ? t('empty.tryDifferentSearch') : t('empty.createFirstList')}
              </p>
              {!query && <CreateListDialog onListCreated={refetch} />}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredLists.map((list, index) => {
              const stats = getListStats(list.id);
              const ListIconComponent = getCategoryIcon(list.name);
              
              return (
                <Card 
                  key={list.id} 
                  className="shadow-card hover:shadow-raised transition-all duration-200 group border-border/50 animate-fade-up overflow-hidden"
                  style={{ animationDelay: `${100 + index * 50}ms` }}
                >
                  <CardContent className="p-0">
                    <Link 
                      to={getLocalizedPath(`/lists/${encodeURIComponent(list.id)}`)}
                      className="flex items-center gap-3 p-4 w-full active:scale-[0.99] transition-transform"
                    >
                      {/* Icon with priority indicator */}
                      <div className="relative">
                        <div className={cn(
                          "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl transition-colors",
                          stats.overdue > 0 ? "bg-priority-high/10" : "bg-primary/10"
                        )}>
                          <ListIconComponent className={cn(
                            "h-6 w-6",
                            stats.overdue > 0 ? "text-priority-high" : "text-primary"
                          )} />
                        </div>
                        {stats.overdue > 0 && (
                          <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-priority-high flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white">{stats.overdue}</span>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground truncate">
                            {list.name}
                          </h3>
                          {!list.is_manual && (
                            <Badge className="text-[10px] px-1.5 py-0 h-4 bg-accent/20 text-accent border-0">
                              {t('badges.ai')}
                            </Badge>
                          )}
                        </div>
                        
                        {/* Stats row */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{stats.active} {t('stats.active')}</span>
                          {stats.overdue > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-priority-high flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                {stats.overdue} {t('stats.overdue')}
                              </span>
                            </>
                          )}
                          {stats.dueThisWeek > 0 && stats.overdue === 0 && (
                            <>
                              <span>•</span>
                              <span className="text-priority-medium flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {stats.dueThisWeek} {t('stats.thisWeek')}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Progress bar */}
                        {stats.total > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <Progress 
                              value={stats.progress} 
                              className="h-1.5 flex-1 bg-muted/50"
                            />
                            <span className="text-[10px] text-muted-foreground font-medium min-w-[32px] text-right">
                              {stats.completed}/{stats.total}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteList(list.id, list.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-destructive/10 rounded-lg touch-target"
                          aria-label="Delete list"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
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
