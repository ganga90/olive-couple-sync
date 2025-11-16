import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReminderPicker } from "./ReminderPicker";
import { RecurringReminderPicker } from "./RecurringReminderPicker";
import { Note } from "@/types/note";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { toast } from "sonner";
import { Clock } from "lucide-react";

interface QuickEditReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
}

export function QuickEditReminderDialog({ open, onOpenChange, note }: QuickEditReminderDialogProps) {
  const { updateNote } = useSupabaseNotesContext();
  const [reminderTime, setReminderTime] = useState<string | null>(note.reminder_time || null);
  const [frequency, setFrequency] = useState<'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'>(
    note.recurrence_frequency || 'none'
  );
  const [interval, setInterval] = useState<number>(note.recurrence_interval || 1);

  const handleSave = async () => {
    try {
      await updateNote(note.id, { 
        reminder_time: reminderTime,
        recurrence_frequency: frequency,
        recurrence_interval: interval
      });
      toast.success(reminderTime ? "Reminder set" : "Reminder removed");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to update reminder");
    }
  };

  const handleSnooze = async (minutes: number) => {
    if (!note.reminder_time) return;
    
    try {
      const currentReminder = new Date(note.reminder_time);
      const snoozedTime = new Date(currentReminder.getTime() + minutes * 60000);
      
      await updateNote(note.id, { reminder_time: snoozedTime.toISOString() });
      toast.success(`Reminder snoozed for ${minutes} minutes`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to snooze reminder");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Reminder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set a reminder for: <span className="font-medium text-foreground">{note.summary}</span>
          </p>
          
          <ReminderPicker 
            value={reminderTime} 
            onChange={setReminderTime}
          />

          <RecurringReminderPicker
            frequency={frequency}
            interval={interval}
            onFrequencyChange={setFrequency}
            onIntervalChange={setInterval}
          />

          {note.reminder_time && (
            <div className="pt-3 border-t space-y-2">
              <p className="text-xs font-medium flex items-center gap-2">
                <Clock className="h-3 w-3" />
                Quick Snooze
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSnooze(5)}
                  className="flex-1"
                >
                  5 min
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSnooze(15)}
                  className="flex-1"
                >
                  15 min
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSnooze(30)}
                  className="flex-1"
                >
                  30 min
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSnooze(60)}
                  className="flex-1"
                >
                  1 hour
                </Button>
              </div>
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
