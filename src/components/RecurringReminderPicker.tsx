import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Repeat } from "lucide-react";

interface RecurringReminderPickerProps {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  onFrequencyChange: (frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly') => void;
  onIntervalChange: (interval: number) => void;
}

export function RecurringReminderPicker({
  frequency,
  interval,
  onFrequencyChange,
  onIntervalChange
}: RecurringReminderPickerProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <Label>Recurring Reminder</Label>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs">Frequency</Label>
          <Select value={frequency} onValueChange={onFrequencyChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {frequency !== 'none' && (
          <div className="space-y-2">
            <Label className="text-xs">Every</Label>
            <Input
              type="number"
              min="1"
              value={interval}
              onChange={(e) => onIntervalChange(parseInt(e.target.value) || 1)}
              className="w-full"
            />
          </div>
        )}
      </div>

      {frequency !== 'none' && (
        <p className="text-xs text-muted-foreground">
          Reminder will repeat every {interval > 1 ? interval : ''} {frequency === 'daily' ? 'day' : frequency === 'weekly' ? 'week' : frequency === 'monthly' ? 'month' : 'year'}{interval > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
