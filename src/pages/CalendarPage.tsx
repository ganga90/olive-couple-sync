import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronLeft, ChevronRight, Plus, User, Users, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/note";

const CalendarPage = () => {
  useSEO({ 
    title: "Calendar — Olive", 
    description: "View and manage your tasks by date with Olive's intelligent calendar." 
  });

  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { currentCouple, you, partner } = useSupabaseCouple();
  const { notes, updateNote } = useSupabaseNotesContext();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Filter notes with due dates and without due dates
  const { tasksWithDates, tasksWithoutDates } = useMemo(() => {
    const withDates: Note[] = [];
    const withoutDates: Note[] = [];
    
    notes.forEach(note => {
      if (note.dueDate) {
        withDates.push(note);
      } else {
        withoutDates.push(note);
      }
    });

    // Sort tasks without dates by priority and creation date
    withoutDates.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
      
      if (aPriority !== bPriority) return bPriority - aPriority;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return {
      tasksWithDates: withDates,
      tasksWithoutDates: withoutDates.slice(0, 10) // Top 10 tasks
    };
  }, [notes]);

  // Get tasks for a specific date
  const getTasksForDate = (date: Date) => {
    return tasksWithDates.filter(task => 
      task.dueDate && isSameDay(parseISO(task.dueDate), date)
    );
  };

  // Get calendar data based on view mode
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  const weekStart = startOfWeek(currentDate);
  const weekEnd = endOfWeek(currentDate);
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const handleDateAssignment = async (task: Note, date: Date | undefined) => {
    await updateNote(task.id, { 
      dueDate: date ? date.toISOString() : null 
    });
  };

  const handleToggleComplete = async (task: Note) => {
    await updateNote(task.id, { completed: !task.completed });
  };

  const navigateToTask = (taskId: string) => {
    navigate(`/notes/${taskId}`);
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "high": return "bg-destructive/10 text-destructive border-destructive/20";
      case "medium": return "bg-olive/10 text-olive border-olive/20";
      case "low": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getAuthorName = (note: Note) => {
    const isYourNote = note.addedBy === "you" || you === note.addedBy;
    return isYourNote ? "You" : partner || "Partner";
  };

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center space-y-4">
            <Calendar className="h-16 w-16 mx-auto text-olive" />
            <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
            <p className="text-muted-foreground">Please sign in to view your calendar</p>
            <Button onClick={() => navigate("/sign-in")} className="bg-gradient-olive text-white">
              Sign In
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft pb-20">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-olive" />
            <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'month' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('month')}
              className={viewMode === 'month' ? 'bg-olive text-white' : ''}
            >
              Month
            </Button>
            <Button
              variant={viewMode === 'week' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('week')}
              className={viewMode === 'week' ? 'bg-olive text-white' : ''}
            >
              Week
            </Button>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(
              viewMode === 'month' ? subMonths(currentDate, 1) : subWeeks(currentDate, 1)
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <h2 className="text-lg font-semibold">
            {viewMode === 'month' 
              ? format(currentDate, 'MMMM yyyy')
              : `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
            }
          </h2>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(
              viewMode === 'month' ? addMonths(currentDate, 1) : addWeeks(currentDate, 1)
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calendar Grid */}
        <Card className="mb-6">
          <CardContent className="p-4">
            {viewMode === 'month' ? (
              <div className="grid grid-cols-7 gap-1">
                {/* Day headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-2 text-center text-sm font-medium text-muted-foreground">
                    {day}
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
                        "min-h-[80px] p-2 border border-border/20 cursor-pointer hover:bg-olive/5 transition-colors",
                        isToday && "bg-olive/10 border-olive/30"
                      )}
                      onClick={() => setSelectedDate(day)}
                    >
                      <div className="text-sm font-medium mb-1">
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-1">
                        {dayTasks.slice(0, 2).map(task => (
                          <div
                            key={task.id}
                            className={cn(
                              "text-xs p-1 rounded truncate cursor-pointer",
                              task.completed ? "opacity-50 line-through" : "",
                              task.priority === 'high' ? "bg-destructive/20 text-destructive" :
                              task.priority === 'medium' ? "bg-olive/20 text-olive" :
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
                          <div className="text-xs text-muted-foreground">
                            +{dayTasks.length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {/* Day headers for week view */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-2 text-center text-sm font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
                
                {/* Week days */}
                {weekDays.map(day => {
                  const dayTasks = getTasksForDate(day);
                  const isToday = isSameDay(day, new Date());
                  
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        "min-h-[120px] p-3 border border-border/20 cursor-pointer hover:bg-olive/5 transition-colors",
                        isToday && "bg-olive/10 border-olive/30"
                      )}
                      onClick={() => setSelectedDate(day)}
                    >
                      <div className="text-lg font-semibold mb-2 text-center">
                        {format(day, 'd')}
                      </div>
                      <div className="space-y-2">
                        {dayTasks.map(task => (
                          <div
                            key={task.id}
                            className={cn(
                              "text-xs p-2 rounded-md cursor-pointer transition-colors border",
                              task.completed ? "opacity-50 line-through" : "",
                              task.priority === 'high' ? "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20" :
                              task.priority === 'medium' ? "bg-olive/10 text-olive border-olive/20 hover:bg-olive/20" :
                              "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToTask(task.id);
                            }}
                          >
                            <div className="font-medium truncate">{task.summary}</div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs opacity-70">
                                {getAuthorName(task)}
                              </span>
                              {task.task_owner && (
                                <span className="text-xs opacity-70">
                                  → {task.task_owner}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {dayTasks.length === 0 && (
                          <div className="text-xs text-muted-foreground/50 text-center py-2">
                            No tasks
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tasks without dates */}
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-olive" />
              Unscheduled Tasks
            </h3>
            
            {tasksWithoutDates.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                All tasks are scheduled! 🎉
              </p>
            ) : (
              <div className="space-y-3">
                {tasksWithoutDates.map(task => (
                  <Card key={task.id} className="p-4 hover:shadow-soft transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleComplete(task)}
                          className="p-0 h-auto hover:bg-transparent"
                        >
                          <CheckCircle2 className={cn(
                            "h-5 w-5",
                            task.completed ? "text-olive" : "text-muted-foreground hover:text-olive"
                          )} />
                        </Button>
                        
                        <div className="flex-1">
                          <h4 
                            className={cn(
                              "font-medium text-sm cursor-pointer hover:text-olive",
                              task.completed && "line-through text-muted-foreground"
                            )}
                            onClick={() => navigateToTask(task.id)}
                          >
                            {task.summary}
                          </h4>
                          
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {getAuthorName(task)}
                            </div>
                            <div>{format(new Date(task.createdAt), "MMM d")}</div>
                            <Badge variant="secondary" className="text-xs">
                              {task.category}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {task.priority && (
                          <Badge variant="outline" className={`text-xs ${getPriorityColor(task.priority)}`}>
                            {task.priority}
                          </Badge>
                        )}
                        
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="text-xs h-7">
                              <Plus className="h-3 w-3 mr-1" />
                              Date
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <CalendarComponent
                              mode="single"
                              selected={undefined}
                              onSelect={(date) => handleDateAssignment(task, date)}
                              initialFocus
                              className="pointer-events-auto"
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default CalendarPage;