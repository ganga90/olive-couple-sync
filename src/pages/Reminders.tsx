import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Clock, Calendar, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { addHours, isBefore, isAfter, addDays, format, formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/hooks/useDateLocale";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { SwipeableReminderCard } from "@/components/SwipeableReminderCard";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/note";

interface ReminderItem {
  note: Note;
  type: "explicit" | "auto-24h" | "auto-2h";
  time: Date;
  label: string;
}

interface GroupedReminders {
  upcoming: ReminderItem[];
  thisWeek: ReminderItem[];
  later: ReminderItem[];
}

const Reminders = () => {
  const { t } = useTranslation(['reminders', 'common']);
  const dateLocale = useDateLocale();
  const { getLocalizedPath } = useLocalizedNavigate();
  
  useSEO({ 
    title: `${t('title')} — Olive`, 
    description: t('empty.description')
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { notes, updateNote } = useSupabaseNotesContext();
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Calculate and group all reminders
  const groupedReminders = useMemo<GroupedReminders>(() => {
    const reminders: ReminderItem[] = [];
    const now = new Date();
    const in24h = addHours(now, 24);
    const in7d = addDays(now, 7);

    notes.forEach(note => {
      if (note.completed) return;

      // Explicit reminders
      if (note.reminder_time) {
        const reminderTime = new Date(note.reminder_time);
        if (isBefore(now, reminderTime)) {
          reminders.push({
            note,
            type: "explicit",
            time: reminderTime,
            label: t('labels.reminder')
          });
        }
      }

      // Automatic due date reminders
      if (note.dueDate) {
        const dueDate = new Date(note.dueDate);
        const reminder24h = addHours(dueDate, -24);
        const reminder2h = addHours(dueDate, -2);
        const autoRemindersSent = (note as any).auto_reminders_sent || [];

        if (isBefore(now, reminder24h) && !autoRemindersSent.includes("24h")) {
          reminders.push({
            note,
            type: "auto-24h",
            time: reminder24h,
            label: t('labels.24hBefore')
          });
        }

        if (isBefore(now, reminder2h) && !autoRemindersSent.includes("2h")) {
          reminders.push({
            note,
            type: "auto-2h",
            time: reminder2h,
            label: t('labels.2hBefore')
          });
        }
      }
    });

    // Sort and group
    const sorted = reminders.sort((a, b) => a.time.getTime() - b.time.getTime());
    
    return {
      upcoming: sorted.filter(r => isBefore(r.time, in24h)),
      thisWeek: sorted.filter(r => isAfter(r.time, in24h) && isBefore(r.time, in7d)),
      later: sorted.filter(r => isAfter(r.time, in7d))
    };
  }, [notes, t]);

  const totalReminders = groupedReminders.upcoming.length + groupedReminders.thisWeek.length + groupedReminders.later.length;

  const handleDeleteReminder = async (reminder: ReminderItem) => {
    if (reminder.type === "explicit") {
      await updateNote(reminder.note.id, { 
        reminder_time: null,
        recurrence_frequency: 'none',
        recurrence_interval: 1
      });
    } else {
      await updateNote(reminder.note.id, { dueDate: null });
    }
  };

  const handleEditReminder = (note: Note) => {
    setEditingNote(note);
  };

  const handleNoteClick = (noteId: string) => {
    navigate(getLocalizedPath(`/notes/${noteId}`));
  };

  const ReminderSection = ({ 
    title, 
    icon: Icon, 
    reminders, 
    variant = "default",
    emptyText
  }: { 
    title: string;
    icon: any;
    reminders: ReminderItem[];
    variant?: "urgent" | "warning" | "default";
    emptyText?: string;
  }) => {
    if (reminders.length === 0 && !emptyText) return null;

    return (
      <div className="space-y-2 animate-fade-up">
        <div className="flex items-center gap-2 px-1">
          <Icon className={cn(
            "h-4 w-4",
            variant === "urgent" && "text-priority-high",
            variant === "warning" && "text-priority-medium",
            variant === "default" && "text-muted-foreground"
          )} />
          <h2 className={cn(
            "text-sm font-semibold uppercase tracking-wide",
            variant === "urgent" && "text-priority-high",
            variant === "warning" && "text-priority-medium",
            variant === "default" && "text-muted-foreground"
          )}>
            {title}
          </h2>
          <Badge variant="secondary" className={cn(
            "ml-auto text-[10px] h-5",
            variant === "urgent" && "bg-priority-high/10 text-priority-high",
            variant === "warning" && "bg-priority-medium/10 text-priority-medium"
          )}>
            {reminders.length}
          </Badge>
        </div>

        {reminders.length === 0 && emptyText ? (
          <Card className="border-dashed">
            <CardContent className="py-4 text-center">
              <p className="text-sm text-muted-foreground">{emptyText}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {reminders.map((reminder, index) => (
              <SwipeableReminderCard
                key={`${reminder.note.id}-${reminder.type}-${index}`}
                reminder={reminder}
                onDelete={() => handleDeleteReminder(reminder)}
                onEdit={reminder.type === "explicit" ? () => handleEditReminder(reminder.note) : undefined}
                onClick={() => handleNoteClick(reminder.note.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Bell className="h-8 w-8 text-primary" />
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
      
      <div className="px-4 pt-6 pb-24 md:pb-6 space-y-6 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
              <p className="text-sm text-muted-foreground">
                {totalReminders === 0 ? t('allCaughtUp') : t('upcoming', { count: totalReminders })}
              </p>
            </div>
          </div>
        </div>

        {/* Empty State */}
        {totalReminders === 0 ? (
          <Card className="shadow-card border-border/50 animate-fade-up">
            <CardContent className="py-12 text-center">
              <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">{t('empty.title')}</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {t('empty.description')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Upcoming (Next 24 hours) */}
            <ReminderSection
              title={t('sections.upcoming24h')}
              icon={AlertTriangle}
              reminders={groupedReminders.upcoming}
              variant="urgent"
            />

            {/* This Week */}
            <ReminderSection
              title={t('sections.thisWeek')}
              icon={Calendar}
              reminders={groupedReminders.thisWeek}
              variant="warning"
            />

            {/* Later */}
            <ReminderSection
              title={t('sections.later')}
              icon={Clock}
              reminders={groupedReminders.later}
              variant="default"
            />
          </div>
        )}
      </div>

      {editingNote && (
        <QuickEditReminderDialog
          open={!!editingNote}
          onOpenChange={(open) => !open && setEditingNote(null)}
          note={editingNote}
        />
      )}
    </div>
  );
};

export default Reminders;
