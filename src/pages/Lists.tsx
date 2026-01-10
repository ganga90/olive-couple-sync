import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSEO } from "@/hooks/useSEO";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { CreateListDialog } from "@/components/CreateListDialog";
import { useAuth } from "@/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useOrganizeAgent } from "@/hooks/useOrganizeAgent";
import { OptimizationReviewModal } from "@/components/OptimizationReviewModal";
import { QuickAccessLists } from "@/components/lists/QuickAccessLists";
import { ListSortFilterBar, type SortOption, type FilterOption } from "@/components/lists/ListSortFilterBar";
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
  Clock,
  Wand2,
  Loader2
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

// Circular Progress Ring Component
const CircularProgress = ({ progress, size = 56, strokeWidth = 4, overdue = false }: { 
  progress: number; 
  size?: number; 
  strokeWidth?: number;
  overdue?: boolean;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        className="text-stone-100"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn(
          "transition-all duration-500",
          overdue ? "text-[hsl(var(--priority-high))]" : "text-primary"
        )}
      />
    </svg>
  );
};

const Lists = () => {
  const navigate = useNavigate();
  const { t } = useTranslation(['lists', 'common']);
  const getLocalizedPath = useLocalizedHref();
  const { isAuthenticated } = useAuth();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recentlyUsed");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");
  const { notes, refetch: refetchNotes } = useSupabaseNotesContext();
  const { currentCouple } = useSupabaseCouple();
  const { lists, loading, deleteList, refetch } = useSupabaseLists(currentCouple?.id || null);
  
  // Organize Agent
  const {
    isAnalyzing,
    isApplying,
    plan,
    isModalOpen,
    setIsModalOpen,
    analyze,
    applyPlan,
  } = useOrganizeAgent({ coupleId: currentCouple?.id, onComplete: () => { refetch(); refetchNotes(); } });
  
  useSEO({ title: `${t('title')} — Olive`, description: t('empty.createFirstList') });

  // Check for shared and AI lists
  const hasSharedLists = useMemo(() => lists.some(list => list.couple_id), [lists]);
  const hasAiLists = useMemo(() => lists.some(list => !list.is_manual), [lists]);

  // Get task count for a list (used for sorting)
  const getListTaskCount = (listId: string) => notes.filter(n => n.list_id === listId).length;

  // Filter and sort lists
  const filteredAndSortedLists = useMemo(() => {
    let result = [...lists];
    
    // Apply search filter
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(list => 
        list.name.toLowerCase().includes(q) || 
        (list.description && list.description.toLowerCase().includes(q))
      );
    }
    
    // Apply category filter
    switch (filterBy) {
      case "shared":
        result = result.filter(list => list.couple_id);
        break;
      case "personal":
        result = result.filter(list => !list.couple_id);
        break;
      case "ai":
        result = result.filter(list => !list.is_manual);
        break;
    }
    
    // Apply sorting
    switch (sortBy) {
      case "alphabetical":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "taskCount":
        result.sort((a, b) => getListTaskCount(b.id) - getListTaskCount(a.id));
        break;
      case "recentlyUsed":
        result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        break;
      case "shared":
        result.sort((a, b) => {
          const aShared = a.couple_id ? 1 : 0;
          const bShared = b.couple_id ? 1 : 0;
          if (bShared !== aShared) return bShared - aShared;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });
        break;
    }
    
    return result;
  }, [query, lists, filterBy, sortBy, notes]);

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center atmosphere-bg">
        <div className="icon-squircle w-20 h-20 mb-6">
          <ListIcon className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-3xl font-serif font-bold text-[#2A3C24] mb-3">{t('title')}</h1>
        <p className="text-stone-500 mb-8 max-w-xs">{t('signInPrompt')}</p>
        <Button variant="accent" size="lg" className="rounded-full px-8" onClick={() => navigate(getLocalizedPath("/sign-in"))}>
          {t('buttons.signIn', { ns: 'common' })}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="h-full overflow-y-auto bg-background atmosphere-bg">
        <div className="px-4 pt-6 pb-24 md:pb-6 space-y-5 max-w-2xl mx-auto relative z-10">
          {/* Header - Editorial Style */}
          <div className="animate-fade-up">
            <h1 className="text-4xl font-serif font-bold text-[#2A3C24] mb-1">{t('title')}</h1>
            <p className="text-stone-500 text-sm">{t('subtitle')}</p>
          </div>

          {/* Quick Access Section - Top 4 most used lists */}
          {!loading && lists.length >= 4 && (
            <QuickAccessLists lists={lists} notes={notes} />
          )}

          {/* Actions Row */}
          <div className="flex items-center gap-3 animate-fade-up" style={{ animationDelay: '50ms' }}>
            {/* Search - Floating Paper Style */}
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-11 bg-white/80 backdrop-blur-xl border-white/40 focus:border-primary rounded-2xl h-12 shadow-[0_4px_20px_rgb(0,0,0,0.03)] placeholder:text-stone-400"
              />
            </div>
            
            {lists.length >= 2 && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => analyze("all")}
                disabled={isAnalyzing}
                className="h-12 w-12 rounded-2xl bg-white/80 backdrop-blur-xl border-white/40 shadow-[0_4px_20px_rgb(0,0,0,0.03)]"
              >
                {isAnalyzing ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <Wand2 className="h-5 w-5 text-primary" />
                )}
              </Button>
            )}
            <CreateListDialog onListCreated={refetch} />
          </div>

          {/* Sort and Filter Bar */}
          {!loading && lists.length > 1 && (
            <ListSortFilterBar
              sortBy={sortBy}
              filterBy={filterBy}
              onSortChange={setSortBy}
              onFilterChange={setFilterBy}
              hasSharedLists={hasSharedLists}
              hasAiLists={hasAiLists}
            />
          )}

          {/* Lists */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="card-glass p-5 animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-[1.25rem] bg-stone-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-32 bg-stone-100 rounded-lg" />
                      <div className="h-3 w-24 bg-stone-100 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredAndSortedLists.length === 0 ? (
            <div className="card-glass p-10 text-center animate-fade-up">
              <div className="icon-squircle w-16 h-16 mx-auto mb-5">
                <ListIcon className="h-8 w-8 text-stone-400" />
              </div>
              <h3 className="font-serif font-semibold text-lg text-[#2A3C24] mb-2">
                {query || filterBy !== "all" ? t('empty.noListsFound') : t('empty.noListsYet')}
              </h3>
              <p className="text-sm text-stone-500 mb-6 max-w-xs mx-auto">
                {query || filterBy !== "all" ? t('empty.tryDifferentSearch') : t('empty.createFirstList')}
              </p>
              {!query && filterBy === "all" && <CreateListDialog onListCreated={refetch} />}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAndSortedLists.map((list, index) => {
                const stats = getListStats(list.id);
                const ListIconComponent = getCategoryIcon(list.name);
                const hasOverdue = stats.overdue > 0;
                
                return (
                  <Link 
                    key={list.id}
                    to={getLocalizedPath(`/lists/${encodeURIComponent(list.id)}`)}
                    className="block group"
                  >
                    <div 
                      className="card-glass p-5 hover:shadow-raised transition-all duration-300 animate-fade-up"
                      style={{ animationDelay: `${100 + index * 50}ms` }}
                    >
                      <div className="flex items-center gap-4">
                        {/* Squircle Icon with Circular Progress */}
                        <div className="relative">
                          {/* Progress Ring */}
                          {stats.total > 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <CircularProgress 
                                progress={stats.progress} 
                                size={56} 
                                strokeWidth={3}
                                overdue={hasOverdue}
                              />
                            </div>
                          )}
                          {/* Icon Container */}
                          <div className={cn(
                            "icon-squircle w-14 h-14 relative z-10",
                            hasOverdue && "bg-[hsl(var(--priority-high))]/10"
                          )}>
                            <ListIconComponent className={cn(
                              "h-6 w-6",
                              hasOverdue ? "text-[hsl(var(--priority-high))]" : "text-primary"
                            )} />
                          </div>
                          {/* Overdue Badge */}
                          {hasOverdue && (
                            <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[hsl(var(--priority-high))] flex items-center justify-center shadow-md z-20">
                              <span className="text-[10px] font-bold text-white">{stats.overdue}</span>
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-serif font-semibold text-[#2A3C24] text-lg truncate">
                              {list.name}
                            </h3>
                            {!list.is_manual && (
                              <Badge className="text-[10px] px-2 py-0.5 h-5 bg-[hsl(var(--magic-accent))]/20 text-[hsl(var(--magic-accent))] border-0 rounded-full">
                                ✨ AI
                              </Badge>
                            )}
                          </div>
                          
                          {/* Stats row */}
                          <div className="flex items-center gap-3 text-xs text-stone-500">
                            <span className="font-medium">{stats.active} active</span>
                            {hasOverdue && (
                              <span className="text-[hsl(var(--priority-high))] flex items-center gap-1 font-medium">
                                <AlertCircle className="h-3 w-3" />
                                {stats.overdue} overdue
                              </span>
                            )}
                            {stats.dueThisWeek > 0 && !hasOverdue && (
                              <span className="text-[hsl(var(--priority-medium))] flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {stats.dueThisWeek} this week
                              </span>
                            )}
                            {stats.total > 0 && (
                              <span className="text-stone-400 ml-auto">
                                {stats.completed}/{stats.total}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteList(list.id, list.name);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-2 hover:bg-[hsl(var(--priority-high))]/10 rounded-xl"
                            aria-label="Delete list"
                          >
                            <Trash2 className="h-4 w-4 text-[hsl(var(--priority-high))]" />
                          </button>
                          <ChevronRight className="h-5 w-5 text-stone-300 group-hover:text-stone-500 group-hover:translate-x-0.5 transition-all duration-200" />
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      {/* Optimization Review Modal */}
      <OptimizationReviewModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        plan={plan}
        onApply={applyPlan}
        isApplying={isApplying}
      />
    </>
  );
};

export default Lists;