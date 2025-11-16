import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReminderPicker } from "./ReminderPicker";
import { Note } from "@/types/note";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { toast } from "sonner";

interface QuickEditReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
}

export function QuickEditReminderDialog({ open, onOpenChange, note }: QuickEditReminderDialogProps) {
  const { updateNote } = useSupabaseNotesContext();

  const handleReminderChange = async (value: string | null) => {
    try {
      await updateNote(note.id, { reminder_time: value });
      toast.success(value ? "Reminder set" : "Reminder removed");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to update reminder");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Reminder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Set a reminder for: <span className="font-medium text-foreground">{note.summary}</span>
          </p>
          <ReminderPicker 
            value={note.reminder_time || null} 
            onChange={handleReminderChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
