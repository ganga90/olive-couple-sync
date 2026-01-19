import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Calendar, User, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { Note } from '@/types/note';
import { useToast } from '@/hooks/use-toast';

interface TaskItemProps {
  task: Note;
  onToggleComplete: (task: Note) => void;
  onTaskClick: (task: Note) => void;
  authorName?: string;
  showCategory?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onToggleComplete,
  onTaskClick,
  authorName,
  showCategory = false
}) => {
  const { t } = useTranslation('home');
  const { toast } = useToast();
  const [isAnimating, setIsAnimating] = useState(false);

  const handleCheckClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!task.completed) {
      setIsAnimating(true);
      
      // Show success toast
      toast({
        title: t('toast.taskCompleted'),
        description: task.summary,
        duration: 2000,
      });
      
      // Slight delay to show animation
      setTimeout(() => {
        onToggleComplete(task);
        setIsAnimating(false);
      }, 300);
    } else {
      onToggleComplete(task);
    }
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !task.completed;

  return (
    <div
      onClick={() => onTaskClick(task)}
      className={cn(
        // EDITORIAL DESKTOP: Large rows with generous padding
        "flex items-center gap-4 md:gap-6 py-4 md:py-6 px-5 md:px-6 rounded-xl md:rounded-2xl transition-all cursor-pointer",
        "bg-stone-50/50 hover:bg-stone-100/80 active:scale-[0.98]",
        "border border-transparent hover:border-stone-200/50",
        task.completed && "opacity-50",
        isAnimating && "animate-scale-in"
      )}
    >
      {/* Checkmark Button - Larger on desktop */}
      <button
        onClick={handleCheckClick}
        className={cn(
          "flex-shrink-0 transition-all duration-300",
          isAnimating && "scale-110"
        )}
        aria-label={task.completed ? "Mark as incomplete" : "Mark as complete"}
      >
        {task.completed ? (
          <CheckCircle2 
            className="h-6 w-6 md:h-7 md:w-7 text-primary" 
            fill="currentColor"
          />
        ) : (
          <Circle className="h-6 w-6 md:h-7 md:w-7 text-stone-400 hover:text-primary transition-colors" />
        )}
      </button>

      {/* Task Content - EDITORIAL TYPOGRAPHY */}
      <div className="flex-1 min-w-0">
        <h3 
          className={cn(
            // DESKTOP: text-xl (20px) font-medium for comfortable reading
            "font-medium text-base md:text-xl leading-snug mb-1 md:mb-2",
            task.completed ? "line-through text-stone-400" : "text-stone-800"
          )}
        >
          {task.summary}
        </h3>
        
        {/* Metadata - DESKTOP: text-sm (14px) muted for hierarchy */}
        <div className="flex items-center gap-3 md:gap-4 text-xs md:text-sm text-stone-500">
          {task.dueDate && (
            <div className={cn(
              "flex items-center gap-1.5",
              isOverdue && "text-destructive font-medium"
            )}>
              <Calendar className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>{format(new Date(task.dueDate), 'MMM d')}</span>
            </div>
          )}
          
          {authorName && (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span>{authorName}</span>
            </div>
          )}
          
          {showCategory && task.category && (
            <span className="capitalize">{task.category}</span>
          )}
          
          {task.category === 'auto' && (
            <div className="flex items-center gap-1 text-[hsl(var(--ai-accent))]">
              <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="font-medium">AI</span>
            </div>
          )}
        </div>
      </div>

      {/* Priority Indicator - Taller on desktop */}
      {task.priority && (
        <div 
          className={cn(
            "w-1 h-10 md:h-14 rounded-full flex-shrink-0",
            task.priority === 'high' && "bg-[hsl(var(--priority-high))]",
            task.priority === 'medium' && "bg-[hsl(var(--priority-medium))]",
            task.priority === 'low' && "bg-[hsl(var(--priority-low))]"
          )}
        />
      )}
    </div>
  );
};