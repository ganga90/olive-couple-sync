import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/components/ui/calendar';
import { Users, CalendarDays, ArrowRight } from 'lucide-react';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useSupabaseNotesContext } from '@/providers/SupabaseNotesProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { format, isSameDay, addDays } from 'date-fns';
import type { Note } from '@/types/note';

export const ContextRail: React.FC = () => {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const { partner, currentCouple } = useSupabaseCouple();
  const { notes } = useSupabaseNotesContext();
  const { getLocalizedPath } = useLanguage();
  
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(new Date());
  
  const partnerName = partner || t('common:common.partner');

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

  const handleEventClick = (noteId: string) => {
    navigate(getLocalizedPath(`/notes/${noteId}`));
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

  return (
    <div className="sticky top-8 space-y-8">
      {/* Partner Status - Transparent card on stone */}
      {currentCouple && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-stone-500">
            {t('home:partnerActivity.railTitle', 'Partner')}
          </p>
          <div className="flex items-center gap-3 py-3">
            <div className="w-10 h-10 rounded-full bg-stone-200/60 flex items-center justify-center">
              <Users className="w-5 h-5 text-stone-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-700">{partnerName}</p>
              <p className="text-xs text-stone-400 italic">
                {t('home:partnerActivity.empty', { name: '' }).replace('{name}', '').trim() || 'is being suspiciously quiet...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Mini Calendar - Minimalist, no borders */}
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

      {/* Upcoming Events - Simple list */}
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
    </div>
  );
};

export default ContextRail;
