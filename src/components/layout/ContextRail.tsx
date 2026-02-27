import React, { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/components/ui/calendar';
import { Users, CalendarDays, ArrowRight, List, CheckSquare, TrendingUp, Clock, UserPlus } from 'lucide-react';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useSupabaseNotesContext } from '@/providers/SupabaseNotesProvider';
import { useSupabaseLists } from '@/hooks/useSupabaseLists';
import { useLanguage } from '@/providers/LanguageProvider';
import { useAuth } from '@/providers/AuthProvider';
import { format, isSameDay, addDays, isToday, startOfDay, formatDistanceToNow } from 'date-fns';
import type { Note } from '@/types/note';
import { cn } from '@/lib/utils';

export const ContextRail: React.FC = () => {
  const { t } = useTranslation(['home', 'common', 'lists', 'calendar']);
  const navigate = useNavigate();
  const location = useLocation();
  const { partner, currentCouple } = useSupabaseCouple();
  const { notes } = useSupabaseNotesContext();
  const { lists } = useSupabaseLists(currentCouple?.id || null);
  const { getLocalizedPath, stripLocalePath } = useLanguage();
  const { user } = useAuth();
  
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(new Date());
  
  const partnerName = partner || t('common:common.partner');
  const cleanPath = stripLocalePath(location.pathname);
  const userId = user?.id;

  // Get upcoming events (tasks with due dates in next 7 days)
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    const nextWeek = addDays(today, 7);
    
    return notes
      .filter(note => {
        if (note.completed) return false;
        if (!note.dueDate) return false;
        const dueDate = new Date(note.dueDate);
        return dueDate >= today && dueDate <= nextWeek;
      })
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
      .slice(0, 4);
  }, [notes]);

  // Get dates that have tasks
  const taskDates = useMemo(() => {
    return notes
      .filter(note => !note.completed && note.dueDate)
      .map(note => new Date(note.dueDate!));
  }, [notes]);

  // Get today's tasks for Calendar page
  const todaysTasks = useMemo(() => {
    const today = startOfDay(new Date());
    return notes
      .filter(note => !note.completed && note.dueDate && isSameDay(new Date(note.dueDate), today))
      .slice(0, 3);
  }, [notes]);

  // Get popular lists for Lists page
  const popularLists = useMemo(() => {
    return lists
      .map(list => ({
        ...list,
        taskCount: notes.filter(n => n.list_id === list.id && !n.completed).length
      }))
      .sort((a, b) => b.taskCount - a.taskCount)
      .slice(0, 4);
  }, [lists, notes]);

  // Get quick stats for Profile page
  const quickStats = useMemo(() => {
    const completed = notes.filter(n => n.completed).length;
    const active = notes.filter(n => !n.completed).length;
    const sharedTasks = notes.filter(n => n.coupleId).length;
    return { completed, active, sharedTasks, total: notes.length };
  }, [notes]);

  const handleEventClick = (noteId: string) => {
    navigate(getLocalizedPath(`/notes/${noteId}`));
  };

  const handleListClick = (listId: string) => {
    navigate(getLocalizedPath(`/lists/${listId}`));
  };

  // Format date for display
  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = addDays(today, 1);
    
    if (isSameDay(date, today)) return t('common:common.today');
    if (isSameDay(date, tomorrow)) return t('common:common.tomorrow');
    return format(date, 'EEE, MMM d');
  };

  // Get recent partner activity (same logic as PartnerActivityWidget)
  const partnerActivity = useMemo(() => {
    if (!userId || !currentCouple) return [];
    return notes
      .filter(note => {
        if (!note.coupleId) return false;
        if (note.authorId === userId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 2)
      .map(note => {
        const youName = currentCouple?.you_name;
        const isAssignedToYou = note.task_owner === 'you' ||
                                note.task_owner === youName ||
                                note.task_owner === userId;
        return {
          id: note.id,
          summary: note.summary,
          createdAt: note.createdAt,
          isAssignedToYou,
        };
      });
  }, [notes, userId, currentCouple]);

  // Render Partner Status with dynamic activity
  const renderPartnerStatus = () => {
    if (!currentCouple) return null;
    
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {t('home:partnerActivity.railTitle', 'Partner')}
        </p>
        <div className="flex items-center gap-3 py-3">
          <div className="w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center">
            <Users className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{partnerName}</p>
            {partnerActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t('home:partnerActivity.empty', { name: partnerName })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('home:partnerActivity.recentCount', { count: partnerActivity.length })}
              </p>
            )}
          </div>
        </div>
        
        {/* Show recent partner activity items */}
        {partnerActivity.length > 0 && (
          <div className="space-y-1.5">
            {partnerActivity.map((activity) => (
              <button
                key={activity.id}
                onClick={() => navigate(getLocalizedPath(`/notes/${activity.id}`))}
                className="w-full text-left group py-2 hover:bg-muted/30 rounded-lg transition-colors px-2 -mx-2"
              >
                <div className="flex items-start gap-2">
                  <div className={cn(
                    "mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                    activity.isAssignedToYou
                      ? 'bg-accent/20 text-accent-foreground'
                      : 'bg-primary/10 text-primary'
                  )}>
                    {activity.isAssignedToYou
                      ? <UserPlus className="w-3 h-3" />
                      : <Users className="w-3 h-3" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate group-hover:text-primary transition-colors">
                      {activity.summary}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Render Mini Calendar
  const renderMiniCalendar = () => (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
        {t('home:contextRail.calendar', 'Calendar')}
      </p>
      <div className="relative">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={setSelectedDate}
          className="p-0 pointer-events-auto"
          classNames={{
            months: "flex flex-col space-y-2",
            month: "space-y-2",
            caption: "flex justify-center pt-0 relative items-center mb-2",
            caption_label: "text-sm font-semibold text-stone-700",
            nav: "space-x-1 flex items-center",
            nav_button: "h-6 w-6 bg-transparent p-0 opacity-50 hover:opacity-100 text-stone-500 hover:bg-stone-200/50 rounded",
            nav_button_previous: "absolute left-0",
            nav_button_next: "absolute right-0",
            table: "w-full border-collapse",
            head_row: "flex",
            head_cell: "text-stone-400 rounded-md w-8 font-medium text-[10px] uppercase tracking-wider",
            row: "flex w-full mt-1",
            cell: "h-8 w-8 text-center text-xs p-0 relative",
            day: "h-8 w-8 p-0 font-normal text-stone-600 hover:bg-stone-100 rounded-full transition-colors",
            day_selected: "bg-primary text-white hover:bg-primary-dark",
            day_today: "text-primary font-bold",
            day_outside: "text-stone-300",
            day_disabled: "text-stone-200",
          }}
          modifiers={{
            hasTask: taskDates
          }}
          modifiersClassNames={{
            hasTask: "ring-2 ring-primary/20 ring-inset"
          }}
        />
      </div>
    </div>
  );

  // Render Upcoming Events
  const renderUpcomingEvents = () => (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
        {t('home:contextRail.upcoming', 'Upcoming')}
      </p>
      
      {upcomingEvents.length > 0 ? (
        <div className="space-y-2">
          {upcomingEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => handleEventClick(event.id)}
              className="w-full text-left group py-2 hover:bg-stone-200/30 rounded-lg transition-colors px-2 -mx-2"
            >
              <div className="flex items-start gap-2">
                <CalendarDays className="w-3.5 h-3.5 text-stone-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-400 mb-0.5">
                    {formatEventDate(event.dueDate!)}
                  </p>
                  <p className="text-sm text-stone-600 group-hover:text-stone-800 truncate transition-colors">
                    {event.summary}
                  </p>
                </div>
                <ArrowRight className="w-3 h-3 text-stone-300 group-hover:text-stone-500 opacity-0 group-hover:opacity-100 transition-all mt-0.5" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-400 italic py-2">
          {t('home:contextRail.noEvents', 'No upcoming events')}
        </p>
      )}
    </div>
  );

  // Render Popular Lists (for Lists page)
  const renderPopularLists = () => (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
        {t('lists:contextRail.popular', 'Popular Lists')}
      </p>
      
      {popularLists.length > 0 ? (
        <div className="space-y-2">
          {popularLists.map((list) => (
            <button
              key={list.id}
              onClick={() => handleListClick(list.id)}
              className="w-full text-left group py-2 hover:bg-stone-200/30 rounded-lg transition-colors px-2 -mx-2"
            >
              <div className="flex items-center gap-2">
                <List className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-600 group-hover:text-stone-800 truncate transition-colors">
                    {list.name}
                  </p>
                </div>
                <span className="text-xs text-stone-400">{list.taskCount}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-400 italic py-2">
          {t('lists:contextRail.noLists', 'No lists yet')}
        </p>
      )}
    </div>
  );

  // Render Today's Focus (for Calendar page)
  const renderTodaysFocus = () => (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
        {t('calendar:contextRail.todaysFocus', "Today's Focus")}
      </p>
      
      {todaysTasks.length > 0 ? (
        <div className="space-y-2">
          {todaysTasks.map((task) => (
            <button
              key={task.id}
              onClick={() => handleEventClick(task.id)}
              className="w-full text-left group py-2 hover:bg-stone-200/30 rounded-lg transition-colors px-2 -mx-2"
            >
              <div className="flex items-center gap-2">
                <CheckSquare className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <p className="text-sm text-stone-600 group-hover:text-stone-800 truncate transition-colors flex-1">
                  {task.summary}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-400 italic py-2">
          {t('calendar:contextRail.noTasksToday', 'No tasks for today')}
        </p>
      )}
    </div>
  );

  // Render Quick Stats (for Profile page)
  const renderQuickStats = () => (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
        {t('profile:contextRail.stats', 'Quick Stats')}
      </p>
      
      <div className="space-y-3">
        <div className="flex items-center gap-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <CheckSquare className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-700">{quickStats.completed}</p>
            <p className="text-xs text-stone-400">{t('profile:contextRail.completed', 'Completed')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 py-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-stone-700">{quickStats.active}</p>
            <p className="text-xs text-stone-400">{t('profile:contextRail.active', 'Active Tasks')}</p>
          </div>
        </div>
        {currentCouple && (
          <div className="flex items-center gap-3 py-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-stone-700">{quickStats.sharedTasks}</p>
              <p className="text-xs text-stone-400">{t('profile:contextRail.shared', 'Shared Tasks')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Determine which content to show based on current route
  const isHomePage = cleanPath === '/home';
  const isListsPage = cleanPath === '/lists' || cleanPath.startsWith('/lists/');
  const isCalendarPage = cleanPath === '/calendar';
  const isProfilePage = cleanPath === '/profile';
  const isRemindersPage = cleanPath === '/reminders';

  return (
    <div className="sticky top-8 space-y-8">
      {/* Partner Status - Show on Home, Lists, Reminders */}
      {(isHomePage || isListsPage || isRemindersPage) && renderPartnerStatus()}

      {/* Mini Calendar - Show on Home, Lists, Profile (not on Calendar page - redundant) */}
      {(isHomePage || isListsPage || isProfilePage) && renderMiniCalendar()}

      {/* Page-specific content */}
      {isHomePage && renderUpcomingEvents()}
      {isListsPage && renderPopularLists()}
      {isCalendarPage && (
        <>
          {renderPartnerStatus()}
          {renderTodaysFocus()}
          {renderUpcomingEvents()}
        </>
      )}
      {isProfilePage && renderQuickStats()}
      {isRemindersPage && (
        <>
          {renderMiniCalendar()}
          {renderUpcomingEvents()}
        </>
      )}
    </div>
  );
};

export default ContextRail;
