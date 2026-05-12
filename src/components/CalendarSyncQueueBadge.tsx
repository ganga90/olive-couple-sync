// CalendarSyncQueueBadge
// ─────────────────────────────────────────────────────────────────────
// Renders the queue's state on `/calendar`. Two visual modes:
//
//   1. Collapsed (default): a small pill showing "N updates pending"
//      next to the existing sync button. Hidden entirely when count
//      is 0 (don't volunteer empty state — the queue being empty is
//      the steady state, and showing "0 pending" creates anxiety
//      where there shouldn't be any).
//
//   2. Expanded: clicking the pill reveals a card listing the queue
//      rows (action type + next-attempt relative time) plus a
//      "Retry now" button that POSTs to calendar-sync-retry.
//
// The pill is the smallest possible affordance that still answers
// "is the 'I'll keep trying in the background' promise being kept?"
// — without taking up calendar real estate on the steady-state happy
// path.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCalendarSyncQueue, type CalendarSyncQueueRow } from "@/hooks/useCalendarSyncQueue";
import { useDateLocale } from "@/hooks/useDateLocale";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CalendarSyncQueueBadge() {
  const { t } = useTranslation("calendar");
  const dateLocale = useDateLocale();
  const { queue, pendingCount, retrying, retryNow } = useCalendarSyncQueue();
  const [expanded, setExpanded] = useState(false);

  // Steady-state: queue empty. Render nothing — the calendar header
  // already has enough going on without an "all clear" indicator.
  if (pendingCount === 0) return null;

  const handleRetry = async () => {
    const ok = await retryNow();
    if (ok) {
      // i18next interpolation: {{count}} keeps the toast localized to
      // the user's locale + handles singular/plural via the chosen key.
      toast.success(t("pendingSyncs.retryToast", { count: pendingCount }));
    } else {
      toast.error(t("pendingSyncs.retryError"));
    }
  };

  // Singular vs plural: pick the right copy key. i18next supports
  // _one / _other plurals but the repo's translation files use
  // explicit keys, so we do the same.
  const badgeLabel = pendingCount === 1
    ? t("pendingSyncs.badgeOne")
    : t("pendingSyncs.badgeMany", { count: pendingCount });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        data-testid="calendar-queue-badge"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
          "bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100",
          "transition-colors touch-target",
        )}
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{badgeLabel}</span>
      </button>

      {expanded && (
        <QueueDropdown
          rows={queue}
          retrying={retrying}
          onRetry={handleRetry}
          onClose={() => setExpanded(false)}
          dateLocale={dateLocale}
          t={t}
        />
      )}
    </div>
  );
}

// ─── Dropdown content ────────────────────────────────────────────────
//
// Extracted to keep the parent focused on the badge + expand state.
// The dropdown is positioned absolutely under the badge — `right-0`
// anchors it to the right edge of the badge button, so on a narrow
// mobile viewport it tucks into the right side of the header instead
// of overflowing off-screen.

interface QueueDropdownProps {
  rows: CalendarSyncQueueRow[];
  retrying: boolean;
  onRetry: () => void | Promise<void>;
  onClose: () => void;
  dateLocale: ReturnType<typeof useDateLocale>;
  t: ReturnType<typeof useTranslation>["t"];
}

function QueueDropdown({ rows, retrying, onRetry, onClose, dateLocale, t }: QueueDropdownProps) {
  return (
    <>
      {/* Click-outside backdrop — invisible, but full-screen so a tap
          anywhere closes the dropdown. z-index sits BELOW the dropdown
          card so the card's own clicks aren't intercepted. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          "absolute right-0 top-full mt-2 z-50 w-72",
          "bg-card rounded-2xl border border-border shadow-lg",
          "p-3 space-y-2",
          "animate-fade-up",
        )}
        role="dialog"
        aria-label={t("pendingSyncs.dialogTitle")}
      >
        <p className="text-xs font-medium text-foreground">
          {t("pendingSyncs.dialogTitle")}
        </p>
        <ul className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
            >
              <span className="truncate">
                {t(`pendingSyncs.actions.${row.action}`)}
              </span>
              <span className="text-[10px] tabular-nums whitespace-nowrap">
                {formatNextAttempt(row.next_attempt_at, dateLocale)}
              </span>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="w-full"
        >
          {retrying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              {t("pendingSyncs.retryingButton")}
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              {t("pendingSyncs.retryButton")}
            </>
          )}
        </Button>
      </div>
    </>
  );
}

// "in 2 minutes" / "in 1 hour" — relative format. When the row is
// already due (next_attempt_at in the past), date-fns returns
// "less than a minute ago" which reads as confusing for a queue that
// hasn't fired yet. Treat past timestamps as "imminent" instead.
function formatNextAttempt(
  iso: string,
  dateLocale: ReturnType<typeof useDateLocale>,
): string {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return "";
  const now = Date.now();
  if (target <= now) {
    // Use a marker the caller's i18n can translate. We don't import
    // t() here because the function is pure; the dropdown does the
    // translation via the `t` it received.
    return "—";
  }
  return formatDistanceToNow(target, {
    addSuffix: true,
    locale: dateLocale,
  });
}
