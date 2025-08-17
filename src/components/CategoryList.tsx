import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Users, User } from "lucide-react";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useNavigate } from "react-router-dom";

interface CategoryListProps {
  title: string;
  category: string;
  shared?: boolean;
}

export const CategoryList: React.FC<CategoryListProps> = ({ 
  title, 
  category, 
  shared = false 
}) => {
  const { getNotesByCategory } = useSupabaseNotesContext();
  const navigate = useNavigate();
  
  const notes = getNotesByCategory(category);
  const incompleteCount = notes.filter(note => !note.completed).length;
  const totalCount = notes.length;

  const handleClick = () => {
    navigate(`/lists/${encodeURIComponent(category)}`);
  };

  if (totalCount === 0) return null;

  return (
    <Card 
      className="p-4 cursor-pointer transition-all duration-200 hover:shadow-soft hover:scale-[1.02] bg-gradient-soft border-olive/20"
      onClick={handleClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-foreground capitalize">
              {title}
            </h3>
            {shared ? (
              <Users className="h-4 w-4 text-olive" />
            ) : (
              <User className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Badge 
              variant="secondary" 
              className="bg-olive/10 text-olive border-olive/20"
            >
              {incompleteCount} active
            </Badge>
            
            {totalCount > incompleteCount && (
              <Badge variant="outline" className="text-xs">
                {totalCount - incompleteCount} done
              </Badge>
            )}
          </div>
        </div>
        
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </Card>
  );
};