// _shared/action-planner.ts
//
// The bridge between classifier output and the offer-before-execute loop.
// Given a ClassifiedIntent for a mutating action (set_due, remind, delete,
// edit_*), the planner:
//
//   1. Resolves the target task via task-disambiguation
//   2. Parses date expressions through the shared natural-date parser
//   3. Captures prior state for later undo
//   4. Returns one of:
//      - a typed PendingOffer (the caller surfaces it as "confirm?")
//      - a DisambiguationOffer (we found ≥2 plausible matches)
//      - null with a reason (no match / unparseable / missing param)
//
// What it deliberately does NOT do:
//   - Touch the DB beyond reads (no writes happen in planning)
//   - Talk to Google Calendar (that's the executor's job, post-confirm)
//   - Resolve confirmation replies (web-session.ts handles those)
//
// Planning is a pure-ish read pipeline. Keeping it separate from the
// executor means tests can lock down the planning logic without
// mocking out every write.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ClassifiedIntent } from "./intent-classifier.ts";
import { parseNaturalDate } from "./natural-date-parser.ts";
import {
  resolveTaskReference,
  type TaskCandidate,
} from "./task-disambiguation.ts";
import type {
  BulkRescheduleCandidate,
  BulkRescheduleOffer,
  DeleteTaskOffer,
  DisambiguationOffer,
  EditTaskOffer,
  PendingOffer,
  RescheduleTaskOffer,
} from "./pending-offer.ts";
import { findConflicts } from "./conflict-detector.ts";
// Phase 3.2 — bulk operations.
import { resolveWeekdayCandidates, shiftToWeekday } from "./bulk-resolver.ts";
// Phase 3.6 — time-only edit support. WhatsApp has had this for months;
// web didn't. Both surfaces should accept "change it to 7am" against an
// existing dated task.
import { extractTimeOnly } from "./time-only-parser.ts";
import { getTimeZoneParts, toUtcFromLocalParts } from "./timezone-calendar.ts";
import { formatFriendlyDate } from "./whatsapp-messaging.ts";
// Phase 3.5 — pattern learning lookup at offer time.
import { findMatchingPatterns, type MatchedPattern } from "./pattern-detector.ts";

// The intents this planner handles. Other intents pass through.
export const PLANNABLE_INTENTS = new Set([
  "set_due",
  "remind",
  "delete",
  "edit_title",
  "edit_location",
  "edit_description",
  "edit_duration",
  // Phase 3.2 — bulk operations follow a different shape (no
  // disambiguation, no single target_task_name) but still go through
  // the offer-before-execute loop.
  "bulk_reschedule_weekday",
]);

export interface PlanContext {
  userId: string;
  spaceId: string | null;
  userTimezone: string;
  originalMessage: string;
}

export type PlanFailure =
  | { kind: "unparseable_date"; expression: string }
  | { kind: "missing_field"; field: string }
  | { kind: "no_match"; reference: string }
  | { kind: "not_plannable" }
  // Phase 3.2 — bulk-specific failure: predicate resolved to zero
  // candidates. Surfaced honestly so the user knows "no Tuesday
  // tasks to move" rather than a generic failure.
  | { kind: "no_bulk_candidates"; from_dow: number };

export type PlanResult =
  | { kind: "offer"; offer: PendingOffer }
  | { kind: "failure"; failure: PlanFailure };

// ─── Entry point ──────────────────────────────────────────────────────

export async function planAction(
  supabase: SupabaseClient,
  intent: ClassifiedIntent,
  ctx: PlanContext,
): Promise<PlanResult> {
  if (!PLANNABLE_INTENTS.has(intent.intent)) {
    return { kind: "failure", failure: { kind: "not_plannable" } };
  }

  // Phase 3.2 — bulk intents bypass the single-task disambiguation
  // pipeline entirely. They have their own resolver (predicate → set)
  // and their own offer shape (BulkRescheduleOffer with a candidate
  // list). Branch early so we never look for a target_task_name on
  // a bulk command.
  if (intent.intent === "bulk_reschedule_weekday") {
    return planBulkRescheduleWeekday(supabase, intent, ctx);
  }

  const reference = (intent.target_task_name || "").trim();
  if (!reference) {
    return { kind: "failure", failure: { kind: "missing_field", field: "target_task_name" } };
  }

  // 1. Resolve the target. Mutating intents never silently first-match —
  // we always go through disambiguation. The verdict tells us whether
  // we can proceed (SINGLE_BEST), need to ask (AMBIGUOUS), or have to
  // bail (NONE).
  const verdict = await resolveTaskReference(supabase, {
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    reference,
  });
  if (verdict.kind === "NONE") {
    return { kind: "failure", failure: { kind: "no_match", reference } };
  }

  // 2. If ambiguous, surface the candidates with the unresolved intent
  // attached so the next turn (the user's pick) can complete the plan.
  if (verdict.kind === "AMBIGUOUS") {
    const pendingIntent = await projectPendingIntent(intent, ctx);
    if (!pendingIntent) {
      // The intent itself failed to plan (e.g. unparseable date) — surface
      // that, not the ambiguity. User can correct the bigger problem first.
      return { kind: "failure", failure: { kind: "unparseable_date", expression: intent.parameters?.due_date_expression || "" } };
    }
    const offer: DisambiguationOffer = {
      type: "disambiguate",
      pending_intent: pendingIntent,
      candidates: verdict.candidates.map((c) => ({
        task_id: c.id,
        summary: c.summary,
        due_date: c.due_date,
        reminder_time: c.reminder_time,
      })),
      original_message: ctx.originalMessage,
      offered_at: new Date().toISOString(),
    };
    return { kind: "offer", offer };
  }

  // 3. SINGLE_BEST. Plan the specific offer for this intent. Pass the
  // supabase client through so the offer can include conflict
  // detection (Phase 3.1).
  const task = verdict.task;
  return planOfferForResolvedTask(intent, task, ctx, supabase);
}

// Phase 3.2 — plan a bulk_reschedule_weekday offer.
//
// Resolution:
//   1. Validate from_dow / to_dow (both 0..6).
//   2. Query all incomplete tasks whose due_date or reminder_time falls
//      on from_dow in the user's timezone.
//   3. For each candidate, pre-compute the new ISO by shifting to the
//      next forward occurrence of to_dow (preserving time-of-day).
//   4. Bail with no_bulk_candidates if the set is empty — surfacing
//      "nothing to do" honestly is better than confusing the user with
//      "your bulk operation succeeded on 0 tasks."
//
// We DO NOT run conflict detection here. Doing conflict detection per
// candidate would create noisy / very long offer copy and the bulk
// operation's preview list already lets the user see what's being
// affected. Phase 3.2.5 can layer per-task conflict warnings.
async function planBulkRescheduleWeekday(
  supabase: SupabaseClient,
  intent: ClassifiedIntent,
  ctx: PlanContext,
): Promise<PlanResult> {
  const p = intent.parameters ?? {};
  const fromDow = p.from_dow;
  const toDow = p.to_dow;
  if (typeof fromDow !== "number" || fromDow < 0 || fromDow > 6) {
    return { kind: "failure", failure: { kind: "missing_field", field: "from_dow" } };
  }
  if (typeof toDow !== "number" || toDow < 0 || toDow > 6) {
    return { kind: "failure", failure: { kind: "missing_field", field: "to_dow" } };
  }
  if (fromDow === toDow) {
    // No-op shift. Treat as not-plannable so the chat falls through to
    // a natural "I'm not sure what to do here" response instead of
    // surfacing an empty offer.
    return { kind: "failure", failure: { kind: "not_plannable" } };
  }

  const raw = await resolveWeekdayCandidates(supabase, {
    userId: ctx.userId,
    spaceId: ctx.spaceId,
    fromDow,
    timezone: ctx.userTimezone,
  });
  if (raw.length === 0) {
    return { kind: "failure", failure: { kind: "no_bulk_candidates", from_dow: fromDow } };
  }

  const candidates: BulkRescheduleCandidate[] = [];
  for (const r of raw) {
    // Anchor the shift on whichever field carries the schedule. Same
    // priority as single-task reschedule (reminder_time > due_date).
    const anchor = r.reminder_time || r.due_date;
    if (!anchor) continue;
    const newIso = shiftToWeekday(anchor, toDow, ctx.userTimezone);
    if (!newIso) continue;
    candidates.push({
      task_id: r.id,
      task_summary: r.summary,
      prior_due_date: r.due_date,
      prior_reminder_time: r.reminder_time,
      new_iso: newIso,
      // We treat a reminder_time anchor as "has a time"; a due_date-only
      // anchor remains all-day after the shift. Mirrors the single-
      // task reschedule contract so the executor reuses the same path.
      field: r.reminder_time ? "reminder_time" : "due_date",
      has_time: !!r.reminder_time,
    });
  }

  if (candidates.length === 0) {
    return { kind: "failure", failure: { kind: "no_bulk_candidates", from_dow: fromDow } };
  }

  const offer: BulkRescheduleOffer = {
    type: "bulk_reschedule_weekday",
    from_dow: fromDow,
    to_dow: toDow,
    timezone: ctx.userTimezone,
    candidates,
    original_message: ctx.originalMessage,
    offered_at: new Date().toISOString(),
  };
  return { kind: "offer", offer };
}

// Plan an offer when we already know which task is being targeted. Used
// both for SINGLE_BEST and (downstream, by the disambiguation resolver)
// for the user's chosen candidate after they pick.
export async function planOfferForResolvedTask(
  intent: ClassifiedIntent,
  task: TaskCandidate,
  ctx: PlanContext,
  // Optional supabase client — required only for Phase 3.1 conflict
  // detection on reschedule offers. Callers without it (older code
  // paths, tests) get offers without a `conflicts` field, which the
  // copy layer treats as "no conflicts to surface."
  supabase?: SupabaseClient,
): Promise<PlanResult> {
  // Fetch full task row for prior-state capture (we need original_text /
  // description) and for Phase 3.1 conflict detection on duration edits
  // (we need reminder_time to know the existing event's start). The
  // task-disambiguation candidate doesn't include these because they're
  // not used for scoring.
  const fullRow = await fetchTaskRow(task.id, supabase);

  switch (intent.intent) {
    case "set_due":
    case "remind": {
      const dateExpr = intent.parameters?.due_date_expression || "";
      if (!dateExpr) {
        return { kind: "failure", failure: { kind: "missing_field", field: "due_date_expression" } };
      }
      const parsed = parseNaturalDate(dateExpr, ctx.userTimezone);

      // Phase 3.6 — time-only fallback. "change it to 7am" carries a
      // time but no date, so parseNaturalDate returns date=null. The
      // pure helper below produces a DST-safe UTC ISO; we keep it
      // separate so it's directly unit-testable without standing up a
      // Supabase mock.
      if (!parsed.date) {
        const anchorIso = fullRow?.reminder_time || fullRow?.due_date || task.reminder_time || task.due_date;
        const resolved = resolveTimeOnlyEdit(dateExpr, anchorIso ?? null, ctx.userTimezone);
        if (resolved) {
          parsed.date = resolved;
          parsed.readable = formatFriendlyDate(resolved, true, ctx.userTimezone, "en");
        }
      }

      if (!parsed.date) {
        return { kind: "failure", failure: { kind: "unparseable_date", expression: dateExpr } };
      }
      const hasTime = readableHasTime(parsed.readable);

      // Phase 3.1 — detect calendar conflicts at offer time. We give
      // a 1-hour default window for events without an explicit end
      // time, matching the calendar-create-event default. Errors here
      // never block the offer — at worst we just don't show conflicts.
      const conflicts = supabase
        ? await safeFindConflicts(supabase, {
            userId: ctx.userId,
            proposedStart: parsed.date,
            proposedEnd: addMinutesIso(parsed.date, hasTime ? 60 : 0),
            proposedAllDay: !hasTime,
            excludeNoteId: task.id,
          })
        : undefined;

      // Phase 3.5 — look up strong patterns that match this proposal.
      // Surface at most one per offer (the strongest), wrapped in the
      // safe helper so DB hiccups never block the planner.
      const pattern_hints = supabase
        ? await safeFindPatterns(supabase, {
            userId: ctx.userId,
            proposedIso: parsed.date,
            timezone: ctx.userTimezone,
          })
        : undefined;

      const offer: RescheduleTaskOffer = {
        type: "reschedule_task",
        task_id: task.id,
        task_summary: task.summary,
        // For 'remind' we write reminder_time; for set_due we still write
        // reminder_time when a time was present (preserves the same
        // contract today's broken handler intended).
        field: intent.intent === "remind" || hasTime ? "reminder_time" : "due_date",
        new_iso: parsed.date,
        has_time: hasTime,
        prior_due_date: fullRow?.due_date ?? task.due_date,
        prior_reminder_time: fullRow?.reminder_time ?? task.reminder_time,
        readable: parsed.readable,
        timezone: ctx.userTimezone,
        conflicts,
        pattern_hints,
        offered_at: new Date().toISOString(),
      };
      return { kind: "offer", offer };
    }

    case "delete": {
      const offer: DeleteTaskOffer = {
        type: "delete_task",
        task_id: task.id,
        task_summary: task.summary,
        prior_due_date: fullRow?.due_date ?? task.due_date,
        prior_reminder_time: fullRow?.reminder_time ?? task.reminder_time,
        offered_at: new Date().toISOString(),
      };
      return { kind: "offer", offer };
    }

    case "edit_title":
    case "edit_location":
    case "edit_description":
    case "edit_duration": {
      const p = intent.parameters ?? {};
      const changes: EditTaskOffer["changes"] = {};
      if (intent.intent === "edit_title" && p.new_title) changes.new_title = p.new_title;
      if (intent.intent === "edit_location" && p.new_location) changes.new_location = p.new_location;
      if (intent.intent === "edit_description" && p.new_description) changes.new_description = p.new_description;
      if (intent.intent === "edit_duration" && p.new_duration_minutes) changes.new_duration_minutes = p.new_duration_minutes;

      if (Object.keys(changes).length === 0) {
        return {
          kind: "failure",
          failure: {
            kind: "missing_field",
            field: intent.intent === "edit_title" ? "new_title"
              : intent.intent === "edit_location" ? "new_location"
              : intent.intent === "edit_description" ? "new_description"
              : "new_duration_minutes",
          },
        };
      }

      // Phase 3.1 — duration changes alter the event window, so we
      // detect conflicts on the new window. Title / location /
      // description don't shift scheduling, so we skip detection there.
      let conflicts: ConflictArrayMaybe = undefined;
      if (
        intent.intent === "edit_duration" &&
        p.new_duration_minutes &&
        supabase &&
        fullRow?.reminder_time
      ) {
        const newEnd = addMinutesIso(fullRow.reminder_time, p.new_duration_minutes);
        conflicts = await safeFindConflicts(supabase, {
          userId: ctx.userId,
          proposedStart: fullRow.reminder_time,
          proposedEnd: newEnd,
          excludeNoteId: task.id,
        });
      }

      const offer: EditTaskOffer = {
        type: "edit_task",
        task_id: task.id,
        task_summary: task.summary,
        changes,
        prior: {
          summary: fullRow?.summary ?? task.summary,
          description: fullRow?.original_text ?? null,
        },
        conflicts,
        offered_at: new Date().toISOString(),
      };
      return { kind: "offer", offer };
    }
  }

  return { kind: "failure", failure: { kind: "not_plannable" } };
}

// ─── Helpers ──────────────────────────────────────────────────────────

// Type alias for the conditional conflicts field. Imported from
// pending-offer.ts via re-export to keep this file self-contained.
type ConflictArrayMaybe = RescheduleTaskOffer["conflicts"];

function addMinutesIso(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

// Wrap findConflicts so a DB hiccup never blocks the offer. The
// failure mode is "user sees the offer without a conflict warning,"
// which is exactly the pre-3.1 behavior — strictly no regression.
async function safeFindConflicts(
  supabase: SupabaseClient,
  args: Parameters<typeof findConflicts>[1],
): Promise<ConflictArrayMaybe> {
  try {
    return await findConflicts(supabase, args);
  } catch (err) {
    console.warn("[action-planner] conflict detection failed (non-fatal):", err);
    return undefined;
  }
}

// Phase 3.5 — same swallow-and-warn wrapper for pattern lookup. A
// failed pattern read should never block the user's reschedule offer.
async function safeFindPatterns(
  supabase: SupabaseClient,
  args: Parameters<typeof findMatchingPatterns>[1],
): Promise<MatchedPattern[] | undefined> {
  try {
    return await findMatchingPatterns(supabase, args);
  } catch (err) {
    console.warn("[action-planner] pattern lookup failed (non-fatal):", err);
    return undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

// Project an unresolved intent into the DisambiguationOffer.pending_intent
// shape so the disambiguation reply can complete planning without
// re-running the classifier.
async function projectPendingIntent(
  intent: ClassifiedIntent,
  ctx: PlanContext,
): Promise<DisambiguationOffer["pending_intent"] | null> {
  switch (intent.intent) {
    case "set_due":
    case "remind": {
      const dateExpr = intent.parameters?.due_date_expression || "";
      if (!dateExpr) return null;
      const parsed = parseNaturalDate(dateExpr, ctx.userTimezone);
      if (!parsed.date) return null;
      return {
        kind: "reschedule_task",
        new_iso: parsed.date,
        has_time: readableHasTime(parsed.readable),
        readable: parsed.readable,
        timezone: ctx.userTimezone,
      };
    }
    case "delete":
      return { kind: "delete_task" };
    case "edit_title":
    case "edit_location":
    case "edit_description":
    case "edit_duration": {
      const p = intent.parameters ?? {};
      const changes: EditTaskOffer["changes"] = {};
      if (intent.intent === "edit_title" && p.new_title) changes.new_title = p.new_title;
      if (intent.intent === "edit_location" && p.new_location) changes.new_location = p.new_location;
      if (intent.intent === "edit_description" && p.new_description) changes.new_description = p.new_description;
      if (intent.intent === "edit_duration" && p.new_duration_minutes) changes.new_duration_minutes = p.new_duration_minutes;
      if (Object.keys(changes).length === 0) return null;
      return { kind: "edit_task", changes };
    }
  }
  return null;
}

// Pull the full clerk_notes row for prior-state capture and conflict
// detection. Returns null when no client is provided (test paths) or
// when the row can't be read — callers fall back to candidate fields.
async function fetchTaskRow(
  taskId: string,
  supabase: SupabaseClient | undefined,
): Promise<
  {
    summary: string;
    original_text: string | null;
    due_date: string | null;
    reminder_time: string | null;
  } | null
> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("clerk_notes")
      .select("summary, original_text, due_date, reminder_time")
      .eq("id", taskId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      summary: (data.summary as string) || "",
      original_text: (data.original_text as string) ?? null,
      due_date: (data.due_date as string) ?? null,
      reminder_time: (data.reminder_time as string) ?? null,
    };
  } catch {
    return null;
  }
}

// Detect whether parseNaturalDate's `readable` reflects a user-supplied
// time-of-day. The parser always populates `date` with a default 9am
// when no time is given, so the readable phrase is our only signal.
// Patterns covered:
//   - "tomorrow at 3:00 PM" / "today at 6pm"
//   - "in 30 minutes" / "in 2 hours"
//   - bare "3:00 PM"
export function readableHasTime(readable: string): boolean {
  if (!readable) return false;
  return (
    /\bat\s+\d/i.test(readable) ||
    /\b\d{1,2}:\d{2}\b/.test(readable) ||
    /\bin\s+\d+\s*(minute|hour|min|hr)/i.test(readable)
  );
}

// Phase 3.6 — pure helper for the time-only fallback. Given an
// expression that's just a time-of-day ("change it to 7am"), the user's
// timezone, and optionally the existing dated anchor (the task's
// current due_date / reminder_time), produce a DST-safe UTC ISO that
// keeps the anchor's date and swaps in the new time-of-day.
//
// Returns null when the expression doesn't carry a parseable time-only
// fragment — caller falls back to the original "unparseable_date"
// failure path.
//
// Why this lives here and not in time-only-parser.ts:
//   - time-only-parser is intentionally pure / synchronous extraction.
//   - This helper composes it with timezone math, which is a different
//     concern owned by the planner.
//   - WhatsApp duplicates this composition inline today; if we ever
//     extract it again we'd unify on this helper.
export function resolveTimeOnlyEdit(
  expression: string,
  anchorIso: string | null,
  timezone: string,
): string | null {
  const timeOnly = extractTimeOnly(expression);
  if (!timeOnly) return null;
  // Anchor strategy: use the task's existing date when available,
  // otherwise fall back to "now". `new Date()` in UTC is fine — the
  // local-parts extraction step below normalizes it to the user's
  // timezone before we replace hour/minute.
  const anchorDate = anchorIso ? new Date(anchorIso) : new Date();
  if (Number.isNaN(anchorDate.getTime())) return null;
  try {
    const localParts = getTimeZoneParts(anchorDate, timezone);
    const newDate = toUtcFromLocalParts(
      {
        ...localParts,
        hour: timeOnly.hours,
        minute: timeOnly.minutes,
        second: 0,
      },
      timezone,
    );
    return newDate.toISOString();
  } catch {
    return null;
  }
}
