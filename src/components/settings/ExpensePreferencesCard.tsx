import React from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenses, ExpenseSplitType } from '@/hooks/useExpenses';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

export const ExpensePreferencesCard: React.FC = () => {
  const { t } = useTranslation('expenses');
  const { preferences, updatePreferences } = useExpenses();
  const { currentCouple, partner } = useSupabaseCouple();
  const hasPartner = Boolean(currentCouple && partner);

  return (
    <div className="space-y-4">
      {/* Tracking Mode */}
      <div>
        <Label className="text-sm">{t('preferences.mode', 'Tracking mode')}</Label>
        <Select
          value={preferences.trackingMode}
          onValueChange={v => updatePreferences({ trackingMode: v })}
        >
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="individual">{t('preferences.modeIndividual', 'Individual')}</SelectItem>
            {hasPartner && (
              <SelectItem value="shared">{t('preferences.modeShared', 'Shared with partner')}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Default Split (only if shared) */}
      {preferences.trackingMode === 'shared' && hasPartner && (
        <div>
          <Label className="text-sm">{t('preferences.defaultSplit', 'Default split')}</Label>
          <Select
            value={preferences.defaultSplit}
            onValueChange={v => updatePreferences({ defaultSplit: v as ExpenseSplitType })}
          >
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="you_paid_split">{t('split.youPaidSplit', 'You paid, split equally', { you: 'You' })}</SelectItem>
              <SelectItem value="you_owed_full">{t('split.youOwedFull', 'Partner owes full', { partner: 'Partner' })}</SelectItem>
              <SelectItem value="partner_paid_split">{t('split.partnerPaidSplit', 'Partner paid, split equally', { partner: 'Partner' })}</SelectItem>
              <SelectItem value="partner_owed_full">{t('split.partnerOwedFull', 'You owe full', { you: 'You' })}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Default Currency */}
      <div>
        <Label className="text-sm">{t('preferences.defaultCurrency', 'Default currency')}</Label>
        <Select
          value={preferences.defaultCurrency}
          onValueChange={v => updatePreferences({ defaultCurrency: v })}
        >
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="USD">$ USD</SelectItem>
            <SelectItem value="EUR">€ EUR</SelectItem>
            <SelectItem value="GBP">£ GBP</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
