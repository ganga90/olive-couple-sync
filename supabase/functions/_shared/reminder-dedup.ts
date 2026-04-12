export interface ReminderLike {
  id: string;
  summary?: string | null;
  reminder_time?: string | null;
  due_date?: string | null;
  auto_reminders_sent?: string[] | null;
  reminder_type?: string | null;
  reminder_message?: string | null;
  _reminderType?: string | null;
  _reminderMsg?: string | null;
}

function getReminderRank(reminder: ReminderLike): number {
  if (reminder.reminder_time) return 100;

  const dueType = reminder.reminder_type ?? reminder._reminderType;
  if (!dueType) return 0;

  switch (dueType) {
    case "15min":
      return 2;
    case "2h":
      return 1;
    case "24h":
      return 0;
    default:
      return 0;
  }
}

function mergeReminder<T extends ReminderLike>(current: T, incoming: T): T {
  const preferred = getReminderRank(incoming) > getReminderRank(current) ? incoming : current;
  const fallback = preferred === incoming ? current : incoming;

  return {
    ...fallback,
    ...preferred,
    auto_reminders_sent: preferred.auto_reminders_sent ?? fallback.auto_reminders_sent ?? [],
  };
}

export function dedupeReminders<T extends ReminderLike>(reminders: T[]): T[] {
  const byId = new Map<string, T>();

  for (const reminder of reminders) {
    if (!reminder?.id) continue;

    const existing = byId.get(reminder.id);
    if (!existing) {
      byId.set(reminder.id, reminder);
      continue;
    }

    byId.set(reminder.id, mergeReminder(existing, reminder));
  }

  return Array.from(byId.values());
}
