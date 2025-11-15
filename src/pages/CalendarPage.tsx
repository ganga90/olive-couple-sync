import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/note";

const CalendarPage = () => {
  useSEO({ 
    title: "Calendar — Olive", 
    description: "View and manage your tasks by date with Olive's intelligent calendar." 
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { notes } = useSupabaseNotesContext();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Filter notes with due dates
  const tasksWithDates = useMemo(() => {
    return notes.filter(note => note.dueDate);
  }, [notes]);

  // Get tasks for a specific date
  const getTasksForDate = (date: Date) => {
    return tasksWithDates.filter(task => 
      task.dueDate && isSameDay(parseISO(task.dueDate), date)
    );
  };

  // Get calendar days
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const navigateToTask = (taskId: string) => {
    navigate(`/notes/${taskId}`);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <Calendar className="h-16 w-16 text-primary mb-4" />
        <h1 className="text-2xl font-semibold mb-2">Calendar</h1>
        <p className="text-muted-foreground mb-6">Sign in to view your calendar</p>
        <Button onClick={() => navigate("/sign-in")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <FloatingActionButton />
      
      <div className="px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <h2 className="text-lg font-semibold">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calendar Grid */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-2 sm:p-4">
            <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
              {/* Day headers */}
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                <div key={i} className="p-1 sm:p-2 text-center text-xs sm:text-sm font-medium text-muted-foreground">
                  <span className="hidden sm:inline">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}
                  </span>
                  <span className="sm:hidden">{day}</span>
                </div>
              ))}
              
              {/* Calendar days */}
              {calendarDays.map(day => {
                const dayTasks = getTasksForDate(day);
                const isToday = isSameDay(day, new Date());
                
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[60px] sm:min-h-[80px] p-1 sm:p-2 border border-border/20 rounded-[var(--radius-sm)] cursor-pointer hover:bg-primary/5 transition-colors",
                      isToday && "bg-primary/10 border-primary/30 ring-1 ring-primary/20"
                    )}
                    onClick={() => setSelectedDate(day)}
                  >
                    <div className={cn(
                      "text-xs sm:text-sm font-medium mb-1",
                      isToday && "text-primary font-bold"
                    )}>
                      {format(day, 'd')}
                    </div>
                    
                    {/* Task indicators */}
                    <div className="space-y-0.5">
                      {dayTasks.slice(0, 2).map(task => (
                        <div
                          key={task.id}
                          className={cn(
                            "text-[10px] sm:text-xs p-0.5 sm:p-1 rounded truncate cursor-pointer",
                            task.completed ? "opacity-50 line-through" : "",
                            task.priority === 'high' ? "bg-[hsl(var(--priority-high))]/20 text-[hsl(var(--priority-high))]" :
                            task.priority === 'medium' ? "bg-[hsl(var(--priority-medium))]/20 text-[hsl(var(--priority-medium))]" :
                            "bg-muted text-muted-foreground"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToTask(task.id);
                          }}
                        >
                          {task.summary}
                        </div>
                      ))}
                      {dayTasks.length > 2 && (
                        <div className="text-[10px] text-muted-foreground pl-0.5 sm:pl-1">
                          +{dayTasks.length - 2}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Selected Date Details */}
        {selectedDate && (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDate(null)}
                >
                  Close
                </Button>
              </div>
              
              {getTasksForDate(selectedDate).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No tasks scheduled for this day
                </p>
              ) : (
                <div className="space-y-2">
                  {getTasksForDate(selectedDate).map(task => (
                    <div
                      key={task.id}
                      onClick={() => navigateToTask(task.id)}
                      className={cn(
                        "p-3 rounded-[var(--radius-md)] border cursor-pointer hover:bg-muted/50 transition-colors",
                        task.completed && "opacity-60"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className={cn(
                            "font-medium text-sm",
                            task.completed && "line-through"
                          )}>
                            {task.summary}
                          </p>
                          {task.priority && (
                            <p className="text-xs text-muted-foreground mt-1 capitalize">
                              {task.priority} priority
                            </p>
                          )}
                        </div>
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
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default CalendarPage;
