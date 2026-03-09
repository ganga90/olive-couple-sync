import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useExpenses, ExpenseSplitType } from '@/hooks/useExpenses';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export const ExpensePreferencesCard: React.FC = () => {
  const { t } = useTranslation('expenses');
  const { preferences, updatePreferences } = useExpenses();
  const { currentCouple, members } = useSupabaseCouple();
  const { user } = useAuth();

  const otherMembers = useMemo(
    () => members.filter(m => m.user_id !== user?.id),
    [members, user?.id]
  );
  const hasMembers = Boolean(currentCouple && otherMembers.length > 0);

  // Build the "Shared with X, Y" label
  const sharedLabel = useMemo(() => {
    if (!hasMembers) return t('preferences.modeShared', 'Shared with partner');
    const names = otherMembers.map(m => m.display_name).join(', ');
    return t('preferences.modeSharedWith', 'Shared with {{names}}', { names });
  }, [hasMembers, otherMembers, t]);

  // Selected member IDs for splitting (stored as comma-separated in preferences or default to all)
  const selectedMemberIds = useMemo(() => {
    if (preferences.sharedWithMembers && preferences.sharedWithMembers.length > 0) {
      return preferences.sharedWithMembers;
    }
    // Default: all other members
    return otherMembers.map(m => m.user_id);
  }, [preferences.sharedWithMembers, otherMembers]);

  const splitParticipantCount = selectedMemberIds.length + 1; // +1 for self

  const toggleMember = (memberId: string) => {
    const current = [...selectedMemberIds];
    const idx = current.indexOf(memberId);
    if (idx >= 0) {
      // Don't allow deselecting all
      if (current.length <= 1) return;
      current.splice(idx, 1);
    } else {
      current.push(memberId);
    }
    updatePreferences({ sharedWithMembers: current });
  };

  const toggleAll = () => {
    const allIds = otherMembers.map(m => m.user_id);
    const allSelected = allIds.every(id => selectedMemberIds.includes(id));
    if (allSelected) {
      // Keep at least one
      updatePreferences({ sharedWithMembers: [allIds[0]] });
    } else {
      updatePreferences({ sharedWithMembers: allIds });
    }
  };

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
            {hasMembers && (
              <SelectItem value="shared">{sharedLabel}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Member picker (only if shared and >1 other member) */}
      {preferences.trackingMode === 'shared' && hasMembers && otherMembers.length > 1 && (
        <div>
          <Label className="text-sm">{t('preferences.splitWith', 'Split expenses with')}</Label>
          <div className="mt-2 space-y-2">
            {/* Select all */}
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={otherMembers.every(m => selectedMemberIds.includes(m.user_id))}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-medium text-foreground">
                {t('preferences.selectAll', 'All members')}
              </span>
            </label>
            {otherMembers.map(member => (
              <label key={member.user_id} className="flex items-center gap-2 cursor-pointer pl-4">
                <Checkbox
                  checked={selectedMemberIds.includes(member.user_id)}
                  onCheckedChange={() => toggleMember(member.user_id)}
                />
                <span className="text-sm text-foreground">{member.display_name}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {t('preferences.splitInfo', 'Expenses split equally among {{count}} people', { count: splitParticipantCount })}
          </p>
        </div>
      )}

      {/* Split info for single partner */}
      {preferences.trackingMode === 'shared' && hasMembers && otherMembers.length === 1 && (
        <p className="text-xs text-muted-foreground">
          {t('preferences.splitInfo', 'Expenses split equally among {{count}} people', { count: 2 })}
        </p>
      )}

      {/* Default Split (only if shared) */}
      {preferences.trackingMode === 'shared' && hasMembers && (
        <div>
          <Label className="text-sm">{t('preferences.defaultSplit', 'Default split')}</Label>
          <Select
            value={preferences.defaultSplit}
            onValueChange={v => updatePreferences({ defaultSplit: v as ExpenseSplitType })}
          >
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="you_paid_split">
                {t('split.youPaidSplit', 'You paid, split equally', { you: t('you', 'You') })}
              </SelectItem>
              <SelectItem value="you_owed_full">
                {otherMembers.length === 1
                  ? t('split.youOwedFull', '{{partner}} owes full amount', { partner: otherMembers[0].display_name })
                  : t('split.othersOweFull', 'Others owe full amount')}
              </SelectItem>
              <SelectItem value="partner_paid_split">
                {otherMembers.length === 1
                  ? t('split.partnerPaidSplit', '{{partner}} paid, split equally', { partner: otherMembers[0].display_name })
                  : t('split.otherPaidSplit', 'Other paid, split equally')}
              </SelectItem>
              <SelectItem value="partner_owed_full">
                {t('split.partnerOwedFull', 'You owe full amount', { you: t('you', 'You') })}
              </SelectItem>
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
