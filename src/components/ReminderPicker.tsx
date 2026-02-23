import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, X, Clock } from "lucide-react";
import { format, addMinutes, addHours, addDays } from "date-fns";

interface ReminderPickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
}

const QUICK_REMINDERS = [
  { labelKey: "picker.5min", fallback: "5 min", minutes: 5 },
  { labelKey: "picker.15min", fallback: "15 min", minutes: 15 },
  { labelKey: "picker.30min", fallback: "30 min", minutes: 30 },
  { labelKey: "picker.1hour", fallback: "1 hour", minutes: 60 },
  { labelKey: "picker.2hours", fallback: "2 hours", minutes: 120 },
  { labelKey: "picker.tomorrow9am", fallback: "Tomorrow 9am", special: "tomorrow9am" },
];

export function ReminderPicker({ value, onChange }: ReminderPickerProps) {
  const { t } = useTranslation('reminders');
  const [date, setDate] = useState<Date | undefined>(
    value ? new Date(value) : undefined
  );
  const [time, setTime] = useState<string>(
    value ? format(new Date(value), "HH:mm") : "09:00"
  );

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (!selectedDate) return;
    setDate(selectedDate);
    
    // Combine date and time
    const [hours, minutes] = time.split(":");
    const combined = new Date(selectedDate);
    combined.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    onChange(combined.toISOString());
  };

  const handleTimeChange = (newTime: string) => {
    setTime(newTime);
    if (!date) return;
    
    const [hours, minutes] = newTime.split(":");
    const combined = new Date(date);
    combined.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    onChange(combined.toISOString());
  };

  const handleQuickReminder = (minutes?: number, special?: string) => {
    const now = new Date();
    let newDate: Date;
    
    if (special === "tomorrow9am") {
      newDate = addDays(now, 1);
      newDate.setHours(9, 0, 0, 0);
    } else if (minutes) {
      newDate = addMinutes(now, minutes);
    } else {
      return;
    }
    
    setDate(newDate);
    setTime(format(newDate, "HH:mm"));
    onChange(newDate.toISOString());
  };

  const handleClear = () => {
    setDate(undefined);
    setTime("09:00");
    onChange(null);
  };

  const generateTimeOptions = () => {
    const options = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const h = hour.toString().padStart(2, "0");
        const m = minute.toString().padStart(2, "0");
        options.push(`${h}:${m}`);
      }
    }
    return options;
  };

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={value ? "default" : "outline"}
            size="sm"
            className="gap-2"
          >
            <Bell className="h-4 w-4" />
            {value ? format(new Date(value), "PPp") : t('picker.setReminder', 'Set Reminder')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 max-h-[80vh] overflow-y-auto" align="start">
          <div className="p-3 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t('picker.quickReminders', 'Quick Reminders')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {QUICK_REMINDERS.map((reminder) => (
                  <Button
                    key={reminder.labelKey}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickReminder(reminder.minutes, reminder.special)}
                    className="text-xs"
                  >
                    {t(reminder.labelKey, reminder.fallback)}
                  </Button>
                ))}
              </div>
            </div>
            
            <div className="relative flex items-center">
              <div className="flex-1 border-t border-border" />
              <span className="px-2 text-xs text-muted-foreground">{t('picker.orPickCustom', 'or pick custom')}</span>
              <div className="flex-1 border-t border-border" />
            </div>
            
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              defaultMonth={new Date()}
              initialFocus
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              className="pointer-events-auto"
            />
            <div className="border-t pt-3">
              <label className="text-sm font-medium mb-2 block">{t('picker.time', 'Time')}</label>
              <Select value={time} onValueChange={handleTimeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {generateTimeOptions().map((timeOption) => (
                    <SelectItem key={timeOption} value={timeOption}>
                      {timeOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
