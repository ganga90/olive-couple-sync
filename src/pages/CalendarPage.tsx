import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, getDay, startOfWeek, endOfWeek, isToday as checkIsToday } from "date-fns";
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

  // Get calendar days with padding for proper grid
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentDate]);

  const navigateToTask = (taskId: string) => {
    navigate(`/notes/${taskId}`);
  };

  // Get priority color dots for a day
  const getPriorityDots = (tasks: Note[]) => {
    const priorities = { high: 0, medium: 0, low: 0 };
    tasks.forEach(task => {
      if (!task.completed && task.priority) {
        priorities[task.priority]++;
      }
    });
    return priorities;
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <CalendarIcon className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Calendar</h1>
        <p className="text-muted-foreground mb-6">Sign in to view your calendar</p>
        <Button variant="accent" onClick={() => navigate("/sign-in")}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <FloatingActionButton />
      
      <div className="px-4 pt-6 pb-24 md:pb-6 space-y-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CalendarIcon className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="flex items-center justify-between bg-card rounded-xl p-2 shadow-card border border-border/50 animate-fade-up" style={{ animationDelay: '50ms' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="touch-target"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <h2 className="text-lg font-semibold text-foreground">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="touch-target"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Calendar Grid */}
        <Card className="shadow-card border-border/50 overflow-hidden animate-fade-up" style={{ animationDelay: '100ms' }}>
          <CardContent className="p-3 sm:p-4">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                <div key={i} className="p-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{day[0]}</span>
                  </span>
                </div>
              ))}
            </div>
            
            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(day => {
                const dayTasks = getTasksForDate(day);
                const isToday = checkIsToday(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const priorityDots = getPriorityDots(dayTasks);
                
                return (
                  <button
                    key={day.toISOString()}
                    className={cn(
                      "relative min-h-[56px] sm:min-h-[72px] p-1.5 sm:p-2 rounded-lg transition-all duration-200",
                      "hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20",
                      !isCurrentMonth && "opacity-40",
                      isToday && "bg-primary/10 ring-2 ring-primary/30",
                      isSelected && "bg-primary/20 ring-2 ring-primary"
                    )}
                    onClick={() => setSelectedDate(day)}
                  >
                    <span className={cn(
                      "text-sm font-medium block",
                      isToday && "text-primary font-bold",
                      !isCurrentMonth && "text-muted-foreground"
                    )}>
                      {format(day, 'd')}
                    </span>
                    
                    {/* Priority dots */}
                    {dayTasks.length > 0 && (
                      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {priorityDots.high > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-priority-high" />
                        )}
                        {priorityDots.medium > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-priority-medium" />
                        )}
                        {priorityDots.low > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-priority-low" />
                        )}
                        {dayTasks.length > 3 && (
                          <span className="text-[8px] text-muted-foreground ml-0.5">
                            +{dayTasks.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-border/50">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-priority-high" />
                <span className="text-[10px] text-muted-foreground">High</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-priority-medium" />
                <span className="text-[10px] text-muted-foreground">Medium</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-priority-low" />
                <span className="text-[10px] text-muted-foreground">Low</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selected Date Details */}
        {selectedDate && (
          <Card className="shadow-card border-border/50 animate-slide-up">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {format(selectedDate, 'EEEE')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {format(selectedDate, 'MMMM d, yyyy')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDate(null)}
                  className="text-muted-foreground"
                >
                  Close
                </Button>
              </div>
              
              {getTasksForDate(selectedDate).length === 0 ? (
                <div className="text-center py-6">
                  <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <CalendarIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No tasks scheduled for this day
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {getTasksForDate(selectedDate).map((task, index) => (
                    <button
                      key={task.id}
                      onClick={() => navigateToTask(task.id)}
                      className={cn(
                        "w-full p-3 rounded-xl border text-left transition-all duration-200",
                        "hover:bg-muted/50 hover:shadow-sm active:scale-[0.99]",
                        task.completed && "opacity-60"
                      )}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start gap-3">
                        {/* Priority indicator */}
                        <div className={cn(
                          "w-1 h-full min-h-[40px] rounded-full flex-shrink-0",
                          task.priority === 'high' && "bg-priority-high",
                          task.priority === 'medium' && "bg-priority-medium",
                          task.priority === 'low' && "bg-priority-low",
                          !task.priority && "bg-muted"
                        )} />
                        
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "font-medium text-sm text-foreground",
                            task.completed && "line-through text-muted-foreground"
                          )}>
                            {task.summary}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-1">
                            {task.reminder_time && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {format(parseISO(task.reminder_time), 'h:mm a')}
                              </div>
                            )}
                            <Badge variant="secondary" className="text-[10px] h-4 capitalize">
                              {task.category}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </button>
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
