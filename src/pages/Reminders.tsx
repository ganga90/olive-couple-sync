import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Calendar, Clock, Trash2, Edit } from "lucide-react";
import { format, formatDistanceToNow, addHours, isBefore } from "date-fns";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { FloatingActionButton } from "@/components/FloatingActionButton";
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
            <Card 
              key={`${reminder.note.id}-${reminder.type}-${index}`} 
              className="shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow cursor-pointer"
              onClick={() => handleNoteClick(reminder.note.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant={reminder.type === "explicit" ? "default" : "secondary"} className="text-xs">
                        {reminder.label}
                      </Badge>
                      {reminder.note.category && (
                        <Badge variant="outline" className="text-xs">
                          {reminder.note.category}
                        </Badge>
                      )}
                    </div>
                    
                    {/* Title */}
                    <h3 className="font-semibold text-base mb-2 line-clamp-2">
                      {reminder.note.summary}
                    </h3>
                    
                    {/* Time details */}
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="font-medium text-foreground">
                          {format(reminder.time, "MMM d 'at' h:mm a")}
                        </span>
                        <span className="text-xs">
                          ({formatDistanceToNow(reminder.time, { addSuffix: true })})
                        </span>
                      </div>
                      
                      {reminder.note.dueDate && (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>Due {format(new Date(reminder.note.dueDate), "MMM d 'at' h:mm a")}</span>
                        </div>
                      )}
                      
                      {reminder.note.recurrence_frequency && reminder.note.recurrence_frequency !== 'none' && (
                        <div className="flex items-center gap-2">
                          <Bell className="h-3.5 w-3.5 flex-shrink-0" />
                          <span>Repeats {reminder.note.recurrence_frequency}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Action buttons */}
                  <div className="flex gap-1 flex-shrink-0">
                    {reminder.type === "explicit" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditReminder(reminder.note);
                        }}
                        aria-label="Edit reminder"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteReminder(reminder);
                      }}
                      aria-label="Delete reminder"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
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
