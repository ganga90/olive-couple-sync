import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin, RefreshCw, Loader2 } from "lucide-react";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useCalendarEvents, CalendarEvent } from "@/hooks/useCalendarEvents";
import { useLocalizedHref } from "@/hooks/useLocalizedNavigate";
import { useDateLocale } from "@/hooks/useDateLocale";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, getDay, startOfWeek, endOfWeek, isToday as checkIsToday } from "date-fns";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/note";

const CalendarPage = () => {
  const { t } = useTranslation(['calendar', 'common']);
  const dateLocale = useDateLocale();
  const getLocalizedPath = useLocalizedHref();
  
  useSEO({ 
    title: `${t('title')} — Olive`, 
    description: t('empty.noTasksScheduled')
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { notes } = useSupabaseNotesContext();
  const { events: calendarEvents, connection, syncing, syncEvents } = useCalendarEvents();
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Show Google Calendar events based on user preference
  const showGoogleEvents = connection?.show_google_events ?? true;

  // Filter notes with due dates
  const tasksWithDates = useMemo(() => {
    return notes.filter(note => note.dueDate);
  }, [notes]);

  // Get Google Calendar events for a specific date
  const getGoogleEventsForDate = (date: Date): CalendarEvent[] => {
    if (!showGoogleEvents) return [];
    return calendarEvents.filter(event => {
      const eventDate = parseISO(event.start_time);
      return isSameDay(eventDate, date);
    });
  };

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
    navigate(getLocalizedPath(`/notes/${taskId}`));
  };

  // Get priority color dots for a day (including Google events)
  const getPriorityDots = (tasks: Note[], googleEvents: CalendarEvent[]) => {
    const priorities = { high: 0, medium: 0, low: 0, google: 0 };
    tasks.forEach(task => {
      if (!task.completed && task.priority) {
        priorities[task.priority]++;
      }
    });
    // Count Google Calendar events
    priorities.google = googleEvents.length;
    return priorities;
  };

  const weekdays = [
    t('weekdays.sun'),
    t('weekdays.mon'),
    t('weekdays.tue'),
    t('weekdays.wed'),
    t('weekdays.thu'),
    t('weekdays.fri'),
    t('weekdays.sat')
  ];

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <CalendarIcon className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
        <p className="text-muted-foreground mb-6">{t('signInPrompt')}</p>
        <Button variant="accent" onClick={() => navigate(getLocalizedPath("/sign-in"))}>{t('buttons.signIn', { ns: 'common' })}</Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <FloatingActionButton />
      
      <div className="px-4 pt-6 pb-32 md:pb-6 space-y-6 max-w-2xl mx-auto">
        {/* Header - Editorial Style */}
        <div className="flex items-center justify-between animate-fade-up">
          <div>
            <h1 className="font-serif font-bold text-4xl text-foreground tracking-tight">
              {format(currentDate, 'MMMM', { locale: dateLocale })}
            </h1>
            <p className="text-lg text-muted-foreground font-medium">
              {format(currentDate, 'yyyy', { locale: dateLocale })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connection?.connected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncEvents()}
                disabled={syncing}
                className="text-muted-foreground rounded-full"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Calendar Navigation - Minimal */}
        <div className="flex items-center justify-between animate-fade-up" style={{ animationDelay: '50ms' }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="touch-target rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="touch-target rounded-full"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Calendar Grid - Editorial Clean */}
        <div className="bg-card rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="p-4 sm:p-6">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {weekdays.map((day, i) => (
                <div key={i} className="p-2 text-center">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{day[0]}</span>
                  </span>
                </div>
              ))}
            </div>
            
            {/* Calendar days - Clean grid, minimal lines */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, index) => {
                const dayTasks = getTasksForDate(day);
                const dayGoogleEvents = getGoogleEventsForDate(day);
                const isToday = checkIsToday(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const priorityDots = getPriorityDots(dayTasks, dayGoogleEvents);
                const hasEvents = dayTasks.length > 0 || dayGoogleEvents.length > 0;
                
                // Add subtle horizontal divider every 7 days (weekly rows)
                const showDivider = index > 0 && index % 7 === 0;
                
                return (
                  <button
                    key={day.toISOString()}
                    className={cn(
                      "relative min-h-[60px] sm:min-h-[72px] p-2 rounded-2xl transition-all duration-300 ease-out",
                      "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                      !isCurrentMonth && "opacity-30",
                      isSelected && "bg-muted ring-2 ring-primary/30",
                      showDivider && "border-t border-border/30"
                    )}
                    onClick={() => setSelectedDate(day)}
                  >
                    {/* Day number - Today gets solid green circle */}
                    <span className={cn(
                      "text-sm font-medium flex items-center justify-center",
                      "w-7 h-7 rounded-full transition-all duration-300",
                      isToday && "bg-primary text-primary-foreground font-bold",
                      !isToday && !isCurrentMonth && "text-muted-foreground"
                    )}>
                      {format(day, 'd')}
                    </span>
                    
                    {/* Priority dots - Event indicators */}
                    {hasEvents && (
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {priorityDots.high > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--priority-high))]" />
                        )}
                        {priorityDots.medium > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--priority-medium))]" />
                        )}
                        {priorityDots.low > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--priority-low))]" />
                        )}
                        {priorityDots.google > 0 && (
                          <div className="h-1.5 w-1.5 rounded-full bg-info" title="Google Calendar" />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend - Minimal */}
            <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-border/30 flex-wrap">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-[hsl(var(--priority-high))]" />
                <span className="text-[10px] text-muted-foreground">{t('priority.high')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-[hsl(var(--priority-medium))]" />
                <span className="text-[10px] text-muted-foreground">{t('priority.medium')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-[hsl(var(--priority-low))]" />
                <span className="text-[10px] text-muted-foreground">{t('priority.low')}</span>
              </div>
              {showGoogleEvents && connection?.connected && (
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-info" />
                  <span className="text-[10px] text-muted-foreground">Google</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selected Date Details */}
        {selectedDate && (
          <div className="bg-card rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-slide-up">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-serif font-semibold text-lg text-foreground">
                    {format(selectedDate, 'EEEE', { locale: dateLocale })}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {format(selectedDate, 'MMMM d, yyyy', { locale: dateLocale })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDate(null)}
                  className="text-muted-foreground rounded-full"
                >
                  {t('actions.close')}
                </Button>
              </div>
              
              {(() => {
                const tasks = getTasksForDate(selectedDate);
                const googleEvents = getGoogleEventsForDate(selectedDate);
                const hasAnyItems = tasks.length > 0 || googleEvents.length > 0;
                
                if (!hasAnyItems) {
                  return (
                    <div className="text-center py-8">
                      <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <CalendarIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t('empty.noTasksScheduled')}
                      </p>
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-2">
                    {/* Olive Tasks */}
                    {tasks.map((task, index) => (
                      <button
                        key={task.id}
                        onClick={() => navigateToTask(task.id)}
                        className={cn(
                          "w-full p-4 rounded-2xl text-left transition-all duration-300 ease-out",
                          "bg-muted/30 hover:bg-muted/50 hover:shadow-sm active:scale-[0.99]",
                          task.completed && "opacity-60"
                        )}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Priority indicator */}
                          <div className={cn(
                            "w-1 h-full min-h-[40px] rounded-full flex-shrink-0",
                            task.priority === 'high' && "bg-[hsl(var(--priority-high))]",
                            task.priority === 'medium' && "bg-[hsl(var(--priority-medium))]",
                            task.priority === 'low' && "bg-[hsl(var(--priority-low))]",
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
                                  {format(parseISO(task.reminder_time), 'h:mm a', { locale: dateLocale })}
                                </div>
                              )}
                              <Badge variant="secondary" className="text-[10px] h-4 capitalize rounded-full">
                                {task.category}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                    
                    {/* Google Calendar Events */}
                    {googleEvents.map((event, index) => (
                      <div
                        key={event.id}
                        className="w-full p-4 rounded-2xl bg-info/5 border border-info/20 text-left"
                        style={{ animationDelay: `${(tasks.length + index) * 50}ms` }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Google Calendar indicator */}
                          <div className="w-1 h-full min-h-[40px] rounded-full flex-shrink-0 bg-info" />
                          
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground">
                              {event.title}
                            </p>
                            
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {!event.all_day && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {format(parseISO(event.start_time), 'h:mm a', { locale: dateLocale })}
                                  {event.end_time && ` - ${format(parseISO(event.end_time), 'h:mm a', { locale: dateLocale })}`}
                                </div>
                              )}
                              {event.location && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <MapPin className="h-3 w-3" />
                                  <span className="truncate max-w-[120px]">{event.location}</span>
                                </div>
                              )}
                              <Badge variant="outline" className="text-[10px] h-4 border-info/30 text-info rounded-full">
                                Google
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarPage;
