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
        "flex items-center gap-3 lg:gap-4 py-3 lg:py-4 px-4 lg:px-5 rounded-[var(--radius-md)] border bg-card transition-all cursor-pointer",
        "hover:shadow-[var(--shadow-raised)] active:scale-[0.98]",
        task.completed && "opacity-60",
        isAnimating && "animate-scale-in"
      )}
    >
      {/* Checkmark Button */}
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
            className="h-6 w-6 lg:h-7 lg:w-7 text-primary" 
            fill="currentColor"
          />
        ) : (
          <Circle className="h-6 w-6 lg:h-7 lg:w-7 text-primary hover:text-primary/80" />
        )}
      </button>

      {/* Task Content */}
      <div className="flex-1 min-w-0">
        <h3 
          className={cn(
            "font-semibold text-base lg:text-lg leading-tight mb-1",
            task.completed ? "line-through text-muted-foreground" : "text-foreground"
          )}
        >
          {task.summary}
        </h3>
        
        {/* Metadata */}
        <div className="flex items-center gap-3 text-xs lg:text-sm text-muted-foreground">
          {task.dueDate && (
            <div className={cn(
              "flex items-center gap-1 lg:gap-1.5",
              isOverdue && "text-destructive font-medium"
            )}>
              <Calendar className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
              <span>{format(new Date(task.dueDate), 'MMM d')}</span>
            </div>
          )}
          
          {authorName && (
            <div className="flex items-center gap-1 lg:gap-1.5">
              <User className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
              <span>{authorName}</span>
            </div>
          )}
          
          {showCategory && task.category && (
            <div className="flex items-center gap-1 lg:gap-1.5">
              <span className="capitalize">{task.category}</span>
            </div>
          )}
          
          {task.category === 'auto' && (
            <div className="flex items-center gap-1 lg:gap-1.5 text-[hsl(var(--ai-accent))]">
              <Sparkles className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
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