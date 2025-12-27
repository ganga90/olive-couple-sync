import React from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronRight, 
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
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useNavigate } from "react-router-dom";

interface CategoryListProps {
  title: string;
  category: string;
  shared?: boolean;
}

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

export const CategoryList: React.FC<CategoryListProps> = ({ 
  title, 
  category, 
  shared = false 
}) => {
  const { t } = useTranslation('lists');
  const { getNotesByCategory } = useSupabaseNotesContext();
  const navigate = useNavigate();
  
  const notes = getNotesByCategory(category);
  const incompleteCount = notes.filter(note => !note.completed).length;
  const totalCount = notes.length;

  const handleClick = () => {
    navigate(`/lists/${encodeURIComponent(category)}`);
  };

  if (totalCount === 0) return null;

  const CategoryIcon = getCategoryIcon(category);

  return (
    <Card 
      className="p-4 cursor-pointer transition-all duration-200 hover:shadow-soft hover:scale-[1.02] bg-gradient-soft border-olive/20"
      onClick={handleClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <CategoryIcon className="h-5 w-5 text-olive" />
            <h3 className="font-semibold text-foreground capitalize">
              {title}
            </h3>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge 
              variant="secondary" 
              className="bg-olive/10 text-olive border-olive/20"
            >
              {incompleteCount} {t('stats.active')}
            </Badge>
            
            {totalCount > incompleteCount && (
              <Badge variant="outline" className="text-xs">
                {totalCount - incompleteCount} {t('stats.done')}
              </Badge>
            )}
          </div>
        </div>
        
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </Card>
  );
};