import { useTranslation } from "react-i18next";
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

const UNIT_KEYS: Record<string, { singular: string; plural: string }> = {
  daily: { singular: 'day', plural: 'days' },
  weekly: { singular: 'week', plural: 'weeks' },
  monthly: { singular: 'month', plural: 'months' },
  yearly: { singular: 'year', plural: 'years' },
};

export function RecurringReminderPicker({
  frequency,
  interval,
  onFrequencyChange,
  onIntervalChange
}: RecurringReminderPickerProps) {
  const { t } = useTranslation('reminders');

  const unitKey = frequency !== 'none' && UNIT_KEYS[frequency]
    ? (interval > 1 ? UNIT_KEYS[frequency].plural : UNIT_KEYS[frequency].singular)
    : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <Label>{t('recurring.title')}</Label>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs">{t('recurring.frequency')}</Label>
          <Select value={frequency} onValueChange={onFrequencyChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('recurring.none')}</SelectItem>
              <SelectItem value="daily">{t('recurring.daily')}</SelectItem>
              <SelectItem value="weekly">{t('recurring.weekly')}</SelectItem>
              <SelectItem value="monthly">{t('recurring.monthly')}</SelectItem>
              <SelectItem value="yearly">{t('recurring.yearly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {frequency !== 'none' && (
          <div className="space-y-2">
            <Label className="text-xs">{t('recurring.every')}</Label>
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
          {t('recurring.summary', {
            interval: interval > 1 ? interval : '',
            unit: t(`recurring.units.${unitKey}`)
          })}
        </p>
      )}
    </div>
  );
}