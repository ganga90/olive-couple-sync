import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { cn } from "@/lib/utils";
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
  Sparkles
} from "lucide-react";
import type { SupabaseList } from "@/hooks/useSupabaseLists";
import type { Note } from "@/types/note";

interface QuickAccessListsProps {
  lists: SupabaseList[];
  notes: Note[];
  privacyFilter?: 'all' | 'shared' | 'private';
}

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

const calculateListScore = (list: SupabaseList, notes: Note[]): number => {
  const listNotes = notes.filter(note => note.list_id === list.id);
  const now = new Date();
  
  // Factor 1: Number of active tasks (weight: 3)
  const activeTasks = listNotes.filter(n => !n.completed).length;
  const activeScore = activeTasks * 3;
  
  // Factor 2: Total tasks (weight: 1)
  const totalScore = listNotes.length * 1;
  
  // Factor 3: Recently added tasks (tasks from last 7 days, weight: 5)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentTasks = listNotes.filter(n => new Date(n.createdAt) > weekAgo).length;
  const recentScore = recentTasks * 5;
  
  // Factor 4: Recently completed tasks (weight: 2)
  const recentlyCompleted = listNotes.filter(n => {
    if (!n.completed) return false;
    const updatedAt = new Date(n.updatedAt);
    return updatedAt > weekAgo;
  }).length;
  const completionScore = recentlyCompleted * 2;
  
  // Factor 5: List freshness (based on updated_at, weight: 2)
  const listAge = now.getTime() - new Date(list.updated_at).getTime();
  const daysOld = listAge / (24 * 60 * 60 * 1000);
  const freshnessScore = Math.max(0, 14 - daysOld) * 2; // Bonus for lists updated in last 2 weeks
  
  return activeScore + totalScore + recentScore + completionScore + freshnessScore;
};

export const QuickAccessLists: React.FC<QuickAccessListsProps> = ({ lists, notes, privacyFilter = 'all' }) => {
  const { t } = useTranslation('lists');
  const getLocalizedPath = useLocalizedHref();
  
  // Calculate scores and get top 4 lists, filtered by privacy preference
  const topLists = React.useMemo(() => {
    if (lists.length === 0) return [];
    
    // Filter lists by privacy preference
    let filteredLists = lists;
    if (privacyFilter === 'private') {
      filteredLists = lists.filter(l => !l.couple_id);
    } else if (privacyFilter === 'shared') {
      filteredLists = lists.filter(l => !!l.couple_id);
    }
    
    if (filteredLists.length === 0) return [];
    
    const scoredLists = filteredLists.map(list => ({
      list,
      score: calculateListScore(list, notes),
      taskCount: notes.filter(n => n.list_id === list.id).length
    }));
    
    // Sort by score descending, then by task count, then by name
    scoredLists.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.taskCount !== a.taskCount) return b.taskCount - a.taskCount;
      return a.list.name.localeCompare(b.list.name);
    });
    
    return scoredLists.slice(0, 4);
  }, [lists, notes]);
  
  if (topLists.length === 0) return null;
  
  return (
    <div className="animate-fade-up" style={{ animationDelay: '75ms' }}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-stone-600">{t('quickAccess.title')}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {topLists.map(({ list, taskCount }, index) => {
          const IconComponent = getCategoryIcon(list.name);
          const listNotes = notes.filter(n => n.list_id === list.id);
          const completedCount = listNotes.filter(n => n.completed).length;
          
          return (
            <Link
              key={list.id}
              to={getLocalizedPath(`/lists/${encodeURIComponent(list.id)}`)}
              className="block group"
            >
              <div 
                className={cn(
                  "card-glass p-4 hover:shadow-raised transition-all duration-300",
                  "flex flex-col items-center text-center gap-2"
                )}
                style={{ animationDelay: `${100 + index * 50}ms` }}
              >
                <div className="icon-squircle w-12 h-12 group-hover:scale-105 transition-transform duration-200">
                  <IconComponent className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 w-full">
                  <h4 className="font-serif font-semibold text-sm text-[#2A3C24] truncate">
                    {list.name}
                  </h4>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {taskCount > 0 ? `${completedCount}/${taskCount}` : t('quickAccess.empty')}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
