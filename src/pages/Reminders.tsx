import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { addHours, isBefore } from "date-fns";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { SwipeableReminderCard } from "@/components/SwipeableReminderCard";
import type { Note } from "@/types/note";

interface ReminderItem {
  note: Note;
  type: "explicit" | "auto-24h" | "auto-2h";
  time: Date;
  label: string;
}

const Reminders = () => {
  useSEO({ 
    title: "Reminders — Olive", 
    description: "View and manage all your scheduled reminders." 
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { notes, updateNote } = useSupabaseNotesContext();
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Calculate all reminders
  const allReminders = useMemo(() => {
    const reminders: ReminderItem[] = [];
    const now = new Date();

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
            label: "Reminder"
          });
        }
      }

      // Automatic due date reminders
      if (note.dueDate) {
        const dueDate = new Date(note.dueDate);
        const reminder24h = addHours(dueDate, -24);
        const reminder2h = addHours(dueDate, -2);
        
        const autoRemindersSent = (note as any).auto_reminders_sent || [];

        // 24h reminder
        if (isBefore(now, reminder24h) && !autoRemindersSent.includes("24h")) {
          reminders.push({
            note,
            type: "auto-24h",
            time: reminder24h,
            label: "24h before due"
          });
        }

        // 2h reminder
        if (isBefore(now, reminder2h) && !autoRemindersSent.includes("2h")) {
          reminders.push({
            note,
            type: "auto-2h",
            time: reminder2h,
            label: "2h before due"
          });
        }
      }
    });

    // Sort by time (earliest first)
    return reminders.sort((a, b) => a.time.getTime() - b.time.getTime());
  }, [notes]);

  const handleDeleteReminder = async (reminder: ReminderItem) => {
    if (reminder.type === "explicit") {
      // Remove explicit reminder
      await updateNote(reminder.note.id, { 
        reminder_time: null,
        recurrence_frequency: 'none',
        recurrence_interval: 1
      });
    } else {
      // For auto reminders, remove the due date
      await updateNote(reminder.note.id, { dueDate: null });
    }
  };

  const handleEditReminder = (note: Note) => {
    setEditingNote(note);
  };

  const handleNoteClick = (noteId: string) => {
    navigate(`/notes/${noteId}`);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <Bell className="h-16 w-16 text-primary mb-4" />
        <h1 className="text-2xl font-semibold mb-2">Reminders</h1>
        <p className="text-muted-foreground mb-6">Sign in to view your reminders</p>
        <Button onClick={() => navigate("/sign-in")}>Sign In</Button>
      </div>
    );
  }

  if (allReminders.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <FloatingActionButton />
        <div className="px-4 py-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Reminders</h1>
          </div>
          
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Bell className="h-16 w-16 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                No upcoming reminders. Set a reminder on a task to get notified!
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <FloatingActionButton />
      
      <div className="px-4 py-6 space-y-4 pb-24 md:pb-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Reminders</h1>
        </div>
        
        {/* Reminders List */}
        <div className="space-y-3">
          {allReminders.map((reminder, index) => (
            <SwipeableReminderCard
              key={`${reminder.note.id}-${reminder.type}-${index}`}
              reminder={reminder}
              onDelete={() => handleDeleteReminder(reminder)}
              onEdit={reminder.type === "explicit" ? () => handleEditReminder(reminder.note) : undefined}
              onClick={() => handleNoteClick(reminder.note.id)}
            />
          ))}
        </div>
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
