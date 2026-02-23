import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { format, parse, isValid } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { parseDateSafely, formatDateForStorage, parseUserDateInput } from '@/utils/dateUtils';

interface DueDateChipProps {
  dueDate: string | null | undefined;
  isOverdue?: boolean;
  onUpdate: (newDate: string | null) => Promise<void>;
}

export const DueDateChip: React.FC<DueDateChipProps> = ({ 
  dueDate, 
  isOverdue = false,
  onUpdate 
}) => {
  const { t } = useTranslation('notes');
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  // Parse the current due date
  const currentDate = parseDateSafely(dueDate);

  // Sync input value when popover opens or date changes
  useEffect(() => {
    if (currentDate) {
      // Format as DD/MM/YYYY for display/input
      setInputValue(format(currentDate, 'dd/MM/yyyy'));
      setSelectedDate(currentDate);
    } else {
      setInputValue('');
      setSelectedDate(undefined);
    }
  }, [dueDate, isOpen]);

  // Handle manual text input
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    
    // Try to parse as DD/MM/YYYY
    if (value.length === 10) {
      const parsed = parse(value, 'dd/MM/yyyy', new Date());
      if (isValid(parsed)) {
        setSelectedDate(parsed);
      }
    }
  };

  // Handle input blur - validate and potentially save
  const handleInputBlur = useCallback(async () => {
    if (!inputValue.trim()) {
      return;
    }
    
    const parsed = parseUserDateInput(inputValue);
    
    if (parsed) {
      setSelectedDate(parsed);
      setInputValue(format(parsed, 'dd/MM/yyyy'));
    } else if (currentDate) {
      // Reset to current date if invalid
      setInputValue(format(currentDate, 'dd/MM/yyyy'));
      setSelectedDate(currentDate);
    }
  }, [inputValue, currentDate]);

  // Handle calendar selection
  const handleCalendarSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      setInputValue(format(date, 'dd/MM/yyyy'));
    }
  };

  // Handle save
  const handleSave = async () => {
    if (selectedDate) {
      await onUpdate(formatDateForStorage(selectedDate));
    }
    setIsOpen(false);
  };

  // Handle clear
  const handleClear = async () => {
    await onUpdate(null);
    setInputValue('');
    setSelectedDate(undefined);
    setIsOpen(false);
  };

  // Display formatted date
  const displayDate = currentDate 
    ? format(currentDate, 'MMM d')
    : t('dueDateChip.noDate', 'No date');

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button className={cn(
          "meta-chip whitespace-nowrap hover:bg-stone-100 transition-colors",
          isOverdue && "bg-[hsl(var(--priority-high))]/10 text-[hsl(var(--priority-high))]"
        )}>
          📅 {displayDate}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          <p className="text-sm font-medium">{t('dueDateChip.setDueDate', 'Set Due Date')}</p>

          {/* Manual Date Input */}
          <Input
            type="text"
            placeholder={t('dueDateChip.placeholder', 'DD/MM/YYYY')}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            className="text-base h-10"
          />
          
          {/* Calendar Picker */}
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleCalendarSelect}
            className="rounded-md border p-3 pointer-events-auto"
            initialFocus
          />
          
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button 
              size="sm" 
              onClick={handleSave}
              disabled={!selectedDate}
              className="flex-1"
            >
              {t('dueDateChip.save', 'Save')}
            </Button>
            {currentDate && (
              <Button
                variant="ghost"
                size="sm"
                className="text-stone-400"
                onClick={handleClear}
              >
                {t('dueDateChip.clear', 'Clear')}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DueDateChip;
