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
        // RADICAL DESKTOP: py-6 for breathing room, larger gaps, rounded-2xl
        "flex items-center gap-4 md:gap-6 py-4 md:py-6 px-5 md:px-8 rounded-xl md:rounded-2xl border bg-card transition-all cursor-pointer",
        "hover:shadow-[var(--shadow-raised)] active:scale-[0.98]",
        task.completed && "opacity-60",
        isAnimating && "animate-scale-in"
      )}
    >
      {/* Checkmark Button - LARGER on desktop */}
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
            className="h-6 w-6 md:h-8 md:w-8 text-primary" 
            fill="currentColor"
          />
        ) : (
          <Circle className="h-6 w-6 md:h-8 md:w-8 text-primary hover:text-primary/80" />
        )}
      </button>

      {/* Task Content - RADICAL TEXT SIZE */}
      <div className="flex-1 min-w-0">
        <h3 
          className={cn(
            // DESKTOP: text-xl (20px) for comfortable reading
            "font-semibold text-base md:text-xl leading-snug mb-1.5 md:mb-2",
            task.completed ? "line-through text-muted-foreground" : "text-foreground"
          )}
        >
          {task.summary}
        </h3>
        
        {/* Metadata - DESKTOP: text-base (16px) for readability */}
        <div className="flex items-center gap-3 md:gap-5 text-sm md:text-base text-muted-foreground">
          {task.dueDate && (
            <div className={cn(
              "flex items-center gap-1.5 md:gap-2",
              isOverdue && "text-destructive font-medium"
            )}>
              <Calendar className="h-4 w-4 md:h-5 md:w-5" />
              <span>{format(new Date(task.dueDate), 'MMM d')}</span>
            </div>
          )}
          
          {authorName && (
            <div className="flex items-center gap-1.5 md:gap-2">
              <User className="h-4 w-4 md:h-5 md:w-5" />
              <span>{authorName}</span>
            </div>
          )}
          
          {showCategory && task.category && (
            <div className="flex items-center gap-1.5 md:gap-2">
              <span className="capitalize">{task.category}</span>
            </div>
          )}
          
          {task.category === 'auto' && (
            <div className="flex items-center gap-1.5 md:gap-2 text-[hsl(var(--ai-accent))]">
              <Sparkles className="h-4 w-4 md:h-5 md:w-5" />
              <span className="font-medium">AI</span>
            </div>
          )}
        </div>
      </div>

      {/* Priority Indicator */}
      {task.priority && (
        <div 
          className={cn(
            "w-1 h-12 rounded-full flex-shrink-0",
            task.priority === 'high' && "bg-[hsl(var(--priority-high))]",
            task.priority === 'medium' && "bg-[hsl(var(--priority-medium))]",
            task.priority === 'low' && "bg-[hsl(var(--priority-low))]"
          )}
        />
      )}
    </div>
  );
};