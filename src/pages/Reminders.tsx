import React, { useMemo } from "react";
import { useSEO } from "@/hooks/useSEO";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Calendar, Clock, Trash2, Edit } from "lucide-react";
import { format, formatDistanceToNow, addHours, isBefore } from "date-fns";
import { QuickEditReminderDialog } from "@/components/QuickEditReminderDialog";
import { useState } from "react";
import type { Note } from "@/types/note";
import { useNavigate } from "react-router-dom";

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
  const { notes, updateNote, deleteNote } = useSupabaseNotesContext();
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

  if (allReminders.length === 0) {
    return (
      <div className="container max-w-4xl px-4 py-8 mx-auto">
        <h1 className="text-3xl font-bold mb-6">Reminders</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              No upcoming reminders. Set a reminder on a task to get notified!
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl px-4 py-8 mx-auto pb-24 md:pb-8">
      <h1 className="text-3xl font-bold mb-6">Reminders</h1>
      
      <div className="space-y-4">
        {allReminders.map((reminder, index) => (
          <Card key={`${reminder.note.id}-${reminder.type}-${index}`} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={reminder.type === "explicit" ? "default" : "secondary"} className="text-xs">
                      {reminder.label}
                    </Badge>
                    {reminder.note.category && (
                      <Badge variant="outline" className="text-xs">
                        {reminder.note.category}
                      </Badge>
                    )}
                  </div>
                  <CardTitle 
                    className="text-lg cursor-pointer hover:text-primary transition-colors"
                    onClick={() => handleNoteClick(reminder.note.id)}
                  >
                    {reminder.note.summary}
                  </CardTitle>
                </div>
                <div className="flex gap-2">
                  {reminder.type === "explicit" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditReminder(reminder.note)}
                      aria-label="Edit reminder"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteReminder(reminder)}
                    aria-label="Delete reminder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span className="font-medium">
                    {format(reminder.time, "MMM d, yyyy 'at' h:mm a")}
                  </span>
                  <span>({formatDistanceToNow(reminder.time, { addSuffix: true })})</span>
                </div>
                {reminder.note.dueDate && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Due: {format(new Date(reminder.note.dueDate), "MMM d, yyyy 'at' h:mm a")}</span>
                  </div>
                )}
                {reminder.note.recurrence_frequency && reminder.note.recurrence_frequency !== 'none' && (
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    <span>Repeats: {reminder.note.recurrence_frequency}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
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
