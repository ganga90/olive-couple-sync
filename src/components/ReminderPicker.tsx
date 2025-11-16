import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, X } from "lucide-react";
import { format } from "date-fns";

interface ReminderPickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
}

export function ReminderPicker({ value, onChange }: ReminderPickerProps) {
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
            {value ? format(new Date(value), "PPp") : "Set Reminder"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3 space-y-3">
            <Calendar
              mode="single"
              selected={date}
              onSelect={handleDateSelect}
              initialFocus
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
            />
            <div className="border-t pt-3">
              <label className="text-sm font-medium mb-2 block">Time</label>
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
