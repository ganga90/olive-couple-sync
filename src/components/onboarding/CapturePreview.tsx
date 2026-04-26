/**
 * CapturePreview — Renders the parsed result of `process-note` as an
 * animated stack of "✓ ..." rows so the user SEES Olive understand what
 * they typed.
 *
 * This is the aha-moment component. The original demo step submitted to
 * `process-note`, fired a toast, and navigated away — meaning the user
 * never witnessed Olive doing the work. Now they do.
 *
 * Input shape mirrors `process-note`'s response (singleNoteSchema /
 * multiNoteSchema). The component normalizes both forms internally so
 * callers don't have to branch.
 */
import { useEffect, useState } from "react";
import { format, isValid, parseISO, type Locale } from "date-fns";
import { useDateLocale } from "@/hooks/useDateLocale";
import {
  Calendar as CalendarIcon,
  ListChecks,
  Bell,
  StickyNote,
  Receipt,
  Sparkles,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types — kept loose because process-note returns a partially-typed
// payload and the fallback branch returns a different shape. We accept
// any object and extract the fields we know how to render. ────────────

export interface ProcessNoteSingle {
  summary?: string;
  category?: string;
  target_list?: string | null;
  due_date?: string | null;
  reminder_time?: string | null;
  items?: string[] | null;
  tags?: string[];
  task_owner?: string | null;
  // Receipt / expense annotations from the process-note flow
  receipt_processed?: boolean;
  receipt?: { amount?: number; merchant?: string };
  // Catch-all for fields we don't render but don't want to lose if
  // callers pass through other metadata
  [key: string]: unknown;
}

export interface ProcessNoteMulti {
  multiple: true;
  notes: ProcessNoteSingle[];
}

export type ProcessNoteResult = ProcessNoteSingle | ProcessNoteMulti;

interface PreviewRow {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
}

interface Props {
  result: ProcessNoteResult;
  /** Called when every row has finished animating in. */
  onAnimationComplete?: () => void;
  /** Stagger between rows (ms). Default 350ms — perceptible but quick. */
  staggerMs?: number;
}

/**
 * Format an ISO date for display in a parse-preview row. Locale-aware,
 * defensively handles invalid input (process-note's fallback branch
 * sometimes emits bad strings).
 */
function formatDueDate(
  iso: string | null | undefined,
  locale: Locale,
): string | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    if (!isValid(d)) return null;
    // "Mon, May 14 at 7:00 PM" — short enough to fit one preview line
    return format(d, "EEE, MMM d 'at' h:mm a", { locale });
  } catch {
    return null;
  }
}

/**
 * Map a single normalized note to a renderable row. The label rules
 * are intentionally narrow — we'd rather under-claim ("Saved a note")
 * than over-claim ("Calendar event with 3 reminders"). The summary text
 * is appended to give the user concrete proof Olive read what they wrote.
 *
 * Categories matched here are a best-guess subset of process-note's
 * (deliberately open-ended) `category` field. Anything we don't
 * recognize falls through to the default note row.
 */
function buildRow(note: ProcessNoteSingle, locale: Locale): PreviewRow {
  const cat = (note.category || "").toLowerCase();
  const summary = (note.summary || "").trim();
  const dueDate = formatDueDate(note.due_date, locale);
  const items = note.items || [];

  // Receipt / expense — process-note annotates result.receipt_processed
  // when it detects a monetary amount. Show a money-flavored row even
  // if the rest of the categorization is generic.
  if (note.receipt_processed && note.receipt?.amount !== undefined) {
    const merchant = note.receipt.merchant || summary || "expense";
    return {
      icon: Receipt,
      label: `Logged $${note.receipt.amount.toFixed(2)} at ${merchant}`,
    };
  }

  // Shopping / groceries with multiple items — count is the value here
  if (
    items.length > 0 &&
    (cat.includes("shop") || cat.includes("groc") || cat.includes("list"))
  ) {
    const listName = note.target_list || "your list";
    return {
      icon: ListChecks,
      label: `Added ${items.length} item${items.length === 1 ? "" : "s"} to ${listName}`,
    };
  }

  // Anything with a due date is either a calendar event or a reminder.
  // Heuristic: if reminder_time matches due_date the user said "remind me"
  // → it's a reminder. Otherwise it's a calendar event.
  if (dueDate) {
    const isReminder =
      note.reminder_time && note.reminder_time === note.due_date;
    return {
      icon: isReminder ? Bell : CalendarIcon,
      label: isReminder
        ? `Reminder set: ${summary}`
        : `Calendar event: ${summary}`,
      detail: dueDate,
    };
  }

  // Plain-list shopping fallback (no items extracted but category fits)
  if (items.length > 0) {
    return {
      icon: ListChecks,
      label: `Saved ${items.length} item${items.length === 1 ? "" : "s"}: ${summary || note.target_list || ""}`.trim(),
    };
  }

  // Default: a simple captured note. Use category as a hint but don't
  // pretend we did more than store the text.
  const categoryLabel = cat && cat !== "task" && cat !== "note"
    ? cat.replace(/_/g, " ")
    : "notes";
  return {
    icon: StickyNote,
    label: `Saved to ${categoryLabel}: ${summary || "your brain dump"}`,
  };
}

/**
 * Normalize either response shape into a flat list of single-note rows.
 * Empty / malformed payloads return a single fallback row so the user
 * never sees a blank preview after submitting.
 */
function normalize(result: ProcessNoteResult): ProcessNoteSingle[] {
  if (!result) return [];
  if ("multiple" in result && result.multiple && Array.isArray(result.notes)) {
    return result.notes.length > 0
      ? result.notes
      : [{ summary: "Captured", category: "note" }];
  }
  return [result as ProcessNoteSingle];
}

export const CapturePreview: React.FC<Props> = ({
  result,
  onAnimationComplete,
  staggerMs = 350,
}) => {
  const locale = useDateLocale();
  const notes = normalize(result);
  const rows: PreviewRow[] = notes.map((n) => buildRow(n, locale));

  // Reveal rows one at a time. We track via a counter so React's
  // reconciler animates only the newly-revealed row, not the whole list.
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (revealed >= rows.length) {
      onAnimationComplete?.();
      return;
    }
    const t = window.setTimeout(() => setRevealed((r) => r + 1), staggerMs);
    return () => window.clearTimeout(t);
  }, [revealed, rows.length, staggerMs, onAnimationComplete]);

  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <span>Olive understood:</span>
      </div>

      {rows.slice(0, revealed).map((row, i) => {
        const Icon = row.icon;
        return (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2.5 shadow-sm",
              "animate-fade-up",
            )}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground leading-snug truncate">
                <Check className="inline h-3.5 w-3.5 mr-1 text-primary" />
                {row.label}
              </p>
              {row.detail && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {row.detail}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CapturePreview;
