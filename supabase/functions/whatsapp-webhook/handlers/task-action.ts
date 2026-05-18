// handlers/task-action.ts — TASK_ACTION intent handler.
// ============================================================================
// Initiative 1.7b of OLIVE_REFACTOR_PLAN.md. The last big intent block
// extracted from the monolithic whatsapp-webhook/index.ts.
//
// Responsibilities (in order):
//
//   A. bulk_reschedule_weekday short-circuit — resolveWeekdayCandidates
//      → shiftToWeekday → freeze pending_action → confirm_bulk_reschedule.
//
//   B. Task resolution priority chain:
//        0a. Quoted-message context (`ctx.quotedTaskCtx?.task_id`) — highest
//        0b. Relative reference ("last task") via isRelativeReference
//        0c. Ordinal ("the first one", "#3") — reads
//            `session.context_data.last_displayed_list` (15-min TTL)
//            then `last_outbound_context.all_task_ids` as fallback
//        1.  AI-supplied UUID with `computeMatchQuality` post-verification
//            (threshold 0.4)
//        2.  Semantic search via `semanticTaskSearchMulti` with ambiguity
//            detection (top-2 scores within 15% → disambiguation offer)
//        3.  Weak candidate handling (quality 0.2–0.4) → "Did you mean X?"
//        4.  Session `last_referenced_entity` (10-min TTL)
//        5.  Recent outbound context fallback
//      Plus the compound CREATE+REMIND path when intent is `remind` but
//      no task resolves — create a new note + set reminder.
//
//   C. Action switch (11 cases):
//        complete, set_priority           — direct update + saveReferencedEntity
//        set_due                          — parseNaturalDate + extractTimeOnly
//                                           + findConflicts + findMatchingPatterns
//                                           + pending_action offer
//        assign, edit_*, delete, remind   — pending_action offers
//        move                             — list lookup (exact → starts-with →
//                                           contains) → direct move OR create
//        default                          — task_action_unknown
//
// Pure-ish handler: external dependencies (`t`, `generateEmbedding`,
// `saveReferencedEntity`) are injected via the factory. The webhook
// dispatch site wires its real implementations; tests pass stubs.
//
// `quotedTaskCtx` is read from `HandlerContext` (added in this PR).
//
// `bulkDayName` / `tasksWord` are duplicated from the webhook because
// they're used by both confirmation-handling (still in monolith) and
// this handler; lifting them to `_shared/whatsapp-localization.ts` is
// a separate cleanup PR.

import { parseNaturalDate } from "../../_shared/natural-date-parser.ts";
import { formatFriendlyDate } from "../../_shared/whatsapp-messaging.ts";
import {
  getTimeZoneParts,
  toUtcFromLocalParts,
} from "../../_shared/timezone-calendar.ts";
import { extractTimeOnly } from "../../_shared/time-only-parser.ts";
import {
  findConflicts,
  type ConflictSummary,
} from "../../_shared/conflict-detector.ts";
import { buildWhatsAppConflictSuffix } from "../../_shared/whatsapp-conflict-copy.ts";
import {
  findMatchingPatterns,
  type MatchedPattern,
} from "../../_shared/pattern-detector.ts";
import { buildWhatsAppPatternSuffix } from "../../_shared/whatsapp-pattern-copy.ts";
import {
  resolveWeekdayCandidates,
  shiftToWeekday,
} from "../../_shared/bulk-resolver.ts";
import {
  isRelativeReference,
  resolveRelativeReference,
  semanticTaskSearchMulti,
  semanticTaskSearch,
  computeMatchQuality,
  type TaskCandidate,
} from "../../_shared/task-search.ts";
import {
  getOutboundContextWithTaskId,
  getRecentOutboundMessages,
  extractTaskFromOutbound,
} from "../../_shared/whatsapp-outbound-context.ts";
import { insertNote } from "../../_shared/note-insert.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";

// ─── Types ─────────────────────────────────────────────────────────────

/** Action types the classifier emits for TASK_ACTION. */
export type TaskActionType =
  | 'complete'
  | 'set_priority'
  | 'set_due'
  | 'assign'
  | 'edit_title'
  | 'edit_location'
  | 'edit_description'
  | 'edit_duration'
  | 'delete'
  | 'move'
  | 'remind'
  | 'bulk_reschedule_weekday';

/** Signature of the webhook's `saveReferencedEntity` closure. Identical
 *  to the one in contextual-ask.ts / partner-message.ts. */
export type SaveReferencedEntityFn = (
  task: { id: string; summary: string; due_date?: string; list_id?: string; priority?: string } | null,
  oliveResponse: string,
  displayedList?: Array<{ id: string; summary: string }>,
) => Promise<void>;

export interface TaskActionDeps {
  /** i18n — used pervasively for confirm_* and error copy. */
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  /** Embedding generator — passed through to semantic search. */
  generateEmbedding: (text: string) => Promise<number[] | null>;
  /** Webhook-local closure that owns conversation_history +
   *  last_referenced_entity writes + outbound-context task stamping. */
  saveReferencedEntity: SaveReferencedEntityFn;
}

// ─── Locale helpers (duplicated from index.ts; kept inline because the
//    webhook still uses them for confirmation copy outside TASK_ACTION).

const BULK_DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BULK_DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const BULK_DAY_NAMES_IT = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

function bulkDayName(dow: number, lang: string): string {
  const idx = Math.max(0, Math.min(6, dow));
  const short = (lang || "en").split("-")[0];
  if (short === "es") return BULK_DAY_NAMES_ES[idx];
  if (short === "it") return BULK_DAY_NAMES_IT[idx];
  return BULK_DAY_NAMES_EN[idx];
}

function tasksWord(n: number, lang: string): string {
  const short = (lang || "en").split("-")[0];
  if (short === "es") return n === 1 ? "tarea" : "tareas";
  if (short === "it") return "attività";
  return n === 1 ? "task" : "tasks";
}

// ─── Ordinal reference parsing (exported for tests) ────────────────────

/** Returns the 0-based ordinal index in the message, or -1 if none. */
export function parseOrdinalIndex(message: string): number {
  const ordinalPatterns = [
    /(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|1st|2nd|3rd|4th|5th|6th|7th|8th)\s*(?:one|task|item)?/i,
    /(?:#|number\s+|no\.?\s*)(\d+)/i,
  ];
  for (const pat of ordinalPatterns) {
    const m = (message || '').match(pat);
    if (!m) continue;
    const val = m[1].toLowerCase();
    const ordinalMap: Record<string, number> = {
      first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7,
      '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4, '6th': 5, '7th': 6, '8th': 7,
    };
    if (ordinalMap[val] !== undefined) return ordinalMap[val];
    const numMatch = val.match(/\d+/);
    if (numMatch) return parseInt(numMatch[0]) - 1;
  }
  return -1;
}

// ─── Factory ───────────────────────────────────────────────────────────

export function makeTaskActionHandler(deps: TaskActionDeps): Handler {
  return async (ctx: HandlerContext): Promise<Reply> => {
    const { t, generateEmbedding, saveReferencedEntity } = deps;
    const {
      supabase, userId, userLang, coupleId, effectiveCoupleId, session,
      messageBody, effectiveMessage, mediaUrls, wamid, inboundNoteSource,
      profile, quotedTaskCtx, intentResult,
    } = ctx;

    // deno-lint-ignore no-explicit-any
    const intentResultAny = intentResult as any;
    const actionType = intentResultAny.actionType as TaskActionType;
    const actionTarget = intentResultAny.actionTarget as string;
    const aiTaskId = intentResultAny._aiTaskId as string | undefined;
    console.log(
      '[WhatsApp] Processing TASK_ACTION:', actionType,
      'target:', actionTarget, 'aiTaskId:', aiTaskId,
    );

    // ========================================================================
    // A. bulk_reschedule_weekday short-circuit
    // ========================================================================
    if (actionType === 'bulk_reschedule_weekday') {
      const fromDow = intentResultAny._fromDow as number | undefined;
      const toDow = intentResultAny._toDow as number | undefined;
      const bulkTz = profile.timezone || 'America/New_York';
      if (typeof fromDow !== 'number' || typeof toDow !== 'number' || fromDow === toDow) {
        return { text: t('edit_need_value', userLang) };
      }
      const raw = await resolveWeekdayCandidates(supabase, {
        userId,
        spaceId: coupleId || null,
        fromDow,
        timezone: bulkTz,
      });
      if (raw.length === 0) {
        return { text: t('bulk_no_candidates', userLang, { from: bulkDayName(fromDow, userLang) }) };
      }

      const candidates = [] as Array<{
        task_id: string;
        task_summary: string;
        prior_due_date: string | null;
        prior_reminder_time: string | null;
        new_iso: string;
        has_time: boolean;
      }>;
      for (const r of raw) {
        const anchor = r.reminder_time || r.due_date;
        if (!anchor) continue;
        const newIso = shiftToWeekday(anchor, toDow, bulkTz);
        if (!newIso) continue;
        candidates.push({
          task_id: r.id,
          task_summary: r.summary,
          prior_due_date: r.due_date,
          prior_reminder_time: r.reminder_time,
          new_iso: newIso,
          has_time: !!r.reminder_time,
        });
      }
      if (candidates.length === 0) {
        return { text: t('bulk_no_candidates', userLang, { from: bulkDayName(fromDow, userLang) }) };
      }

      const previewN = Math.min(5, candidates.length);
      const previewLines = candidates.slice(0, previewN).map((c) => `• ${c.task_summary}`).join('\n');
      const moreCount = candidates.length - previewN;
      const moreTail = moreCount > 0
        ? '\n…' + (userLang.startsWith('es') ? `y ${moreCount} más` : userLang.startsWith('it') ? `e ${moreCount} in più` : `and ${moreCount} more`)
        : '';

      const bulkCtx = (session.context_data || {}) as ConversationContext;
      await supabase
        .from('user_sessions')
        .update({
          conversation_state: 'AWAITING_CONFIRMATION',
          context_data: {
            ...bulkCtx,
            pending_action: {
              type: 'bulk_reschedule_weekday',
              from_dow: fromDow,
              to_dow: toDow,
              timezone: bulkTz,
              candidates,
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      return {
        text: t('confirm_bulk_reschedule', userLang, {
          n: String(candidates.length),
          tasks_word: tasksWord(candidates.length, userLang),
          from: bulkDayName(fromDow, userLang),
          to: bulkDayName(toDow, userLang),
          preview: previewLines,
          more: moreTail,
        }),
      };
    }

    // ========================================================================
    // B. Task resolution chain (priority order)
    // ========================================================================
    // deno-lint-ignore no-explicit-any
    let foundTask: any = null;

    // 0a. QUOTED-MESSAGE RESOLUTION (HIGHEST priority).
    if (quotedTaskCtx?.task_id) {
      const { data: quotedTask } = await supabase
        .from('clerk_notes')
        .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
        .eq('id', quotedTaskCtx.task_id)
        .maybeSingle();
      if (quotedTask) {
        foundTask = quotedTask;
        console.log('[TASK_ACTION] Resolved via quoted-message context:', quotedTask.summary);
      } else {
        console.warn(
          '[TASK_ACTION] Quoted task_id', quotedTaskCtx.task_id,
          'no longer in DB — falling back to other resolution paths',
        );
      }
    }

    // 0b. RELATIVE REFERENCE: "last task", "the latest one", "previous task".
    if (!foundTask && actionTarget && isRelativeReference(actionTarget)) {
      console.log('[TASK_ACTION] Detected relative reference:', actionTarget);
      foundTask = await resolveRelativeReference(supabase, userId, coupleId);
      if (foundTask) {
        console.log('[TASK_ACTION] Resolved relative reference to:', foundTask.summary);
      }
    }
    if (!foundTask && messageBody && isRelativeReference(messageBody.replace(/^(?:cancel|delete|remove|complete|done\s+with|finish|mark\s+(?:as\s+)?done)\s+/i, '').trim())) {
      console.log('[TASK_ACTION] Detected relative reference in cleaned message');
      foundTask = await resolveRelativeReference(supabase, userId, coupleId);
    }

    // 0c. ORDINAL RESOLUTION: "the first one", "#3", etc.
    if (!foundTask) {
      const ordinalIndex = parseOrdinalIndex(messageBody || '');
      if (ordinalIndex >= 0) {
        const sessionCtx = (session.context_data || {}) as ConversationContext;
        if (sessionCtx.last_displayed_list && sessionCtx.list_displayed_at) {
          const listAge = Date.now() - new Date(sessionCtx.list_displayed_at).getTime();
          if (listAge < 15 * 60 * 1000) {
            if (ordinalIndex < sessionCtx.last_displayed_list.length) {
              const listItem = sessionCtx.last_displayed_list[ordinalIndex];
              const { data: listTask } = await supabase
                .from('clerk_notes')
                .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
                .eq('id', listItem.id)
                .maybeSingle();
              if (listTask) {
                foundTask = listTask;
                console.log(`[Context] Resolved ordinal #${ordinalIndex + 1} to task: ${listTask.summary}`);
              }
            } else {
              console.log(`[Context] Ordinal #${ordinalIndex + 1} out of range (list has ${sessionCtx.last_displayed_list.length} items)`);
            }
          } else {
            console.log('[Context] Displayed list is stale (>15 min)');
          }
        } else {
          console.log('[Context] No displayed list in session for ordinal resolution');
          try {
            const outboundCtx = await getOutboundContextWithTaskId(supabase, userId);
            if (outboundCtx?.all_task_ids && ordinalIndex < outboundCtx.all_task_ids.length) {
              const taskRef = outboundCtx.all_task_ids[ordinalIndex];
              const { data: outboundTask } = await supabase
                .from('clerk_notes')
                .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
                .eq('id', taskRef.id)
                .maybeSingle();
              if (outboundTask) {
                foundTask = outboundTask;
                console.log(`[Context] Resolved ordinal #${ordinalIndex + 1} from outbound context: ${outboundTask.summary}`);
              }
            }
          } catch (outboundErr) {
            console.warn('[Context] Outbound context ordinal fallback failed:', outboundErr);
          }
        }
      }
    }

    // 1. AI-supplied UUID with post-match verification.
    if (!foundTask && aiTaskId) {
      const { data: directTask } = await supabase
        .from('clerk_notes')
        .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
        .eq('id', aiTaskId)
        .maybeSingle();

      if (directTask) {
        const matchQuality = actionTarget ? computeMatchQuality(actionTarget, directTask.summary) : 1;
        if (matchQuality >= 0.4 || !actionTarget) {
          console.log('[TASK_ACTION] Direct AI task match:', directTask.summary, 'matchQ:', matchQuality.toFixed(2));
          foundTask = directTask;
        } else {
          console.log(`[TASK_ACTION] AI UUID match "${directTask.summary}" REJECTED — matchQ ${matchQuality.toFixed(2)} for query "${actionTarget}"`);
        }
      }
    }

    // Pronoun detection (en/es/it).
    const isPronoun = !actionTarget || /^(it|that|this|lo|eso|quello|la|esa|questa|quello)$/i.test(actionTarget.trim());

    // 2. Semantic search with ambiguity + weak-candidate detection.
    let weakCandidate: TaskCandidate | null = null;
    if (!foundTask && actionTarget && !isPronoun && !isRelativeReference(actionTarget)) {
      const candidates = await semanticTaskSearchMulti(supabase, userId, coupleId, actionTarget, generateEmbedding, 5);

      if (candidates.length > 0) {
        const best = candidates[0];
        const bestMQ = best.matchQuality ?? 0;

        const AMBIGUITY_THRESHOLD = 0.15;
        const MIN_MATCH_QUALITY = 0.4;
        const WEAK_CANDIDATE_FLOOR = 0.2;

        if (bestMQ < MIN_MATCH_QUALITY) {
          if (bestMQ >= WEAK_CANDIDATE_FLOOR) {
            weakCandidate = best;
            console.log(`[TASK_ACTION] Weak candidate "${best.summary}" quality ${bestMQ.toFixed(2)} — will offer as "did you mean?"`);
          } else {
            console.log(`[TASK_ACTION] Best match "${best.summary}" quality ${bestMQ.toFixed(2)} below threshold, skipping`);
          }
        } else if (candidates.length >= 2) {
          const secondMQ = candidates[1].matchQuality ?? 0;
          const scoreDiff = bestMQ - secondMQ;

          if (secondMQ >= MIN_MATCH_QUALITY && scoreDiff < AMBIGUITY_THRESHOLD) {
            console.log(`[TASK_ACTION] AMBIGUOUS: "${best.summary}" (${bestMQ.toFixed(2)}) vs "${candidates[1].summary}" (${secondMQ.toFixed(2)})`);

            const ambiguousCandidates = candidates.filter((c) => (c.matchQuality ?? 0) >= MIN_MATCH_QUALITY).slice(0, 4);
            const optionsList = ambiguousCandidates.map((c, i) => `${i + 1}. ${c.summary}`).join('\n');

            const disambigCtx = (session.context_data || {}) as ConversationContext;
            await supabase
              .from('user_sessions')
              .update({
                conversation_state: 'AWAITING_DISAMBIGUATION',
                context_data: {
                  ...disambigCtx,
                  pending_action: {
                    type: actionType,
                    candidates: ambiguousCandidates.map((c) => ({ id: c.id, summary: c.summary })),
                    original_query: actionTarget,
                  },
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', session.id);

            return { text: t('task_ambiguous', userLang, { query: actionTarget, options: optionsList }) };
          } else {
            foundTask = best;
            console.log(`[TASK_ACTION] Clear match: "${best.summary}" (${bestMQ.toFixed(2)}) vs next (${secondMQ.toFixed(2)})`);
          }
        } else {
          foundTask = best;
          console.log(`[TASK_ACTION] Single match: "${best.summary}" (${bestMQ.toFixed(2)})`);
        }
      }
    }

    // 3. Session last_referenced_entity (10-min TTL).
    if (!foundTask) {
      const sessionCtx = (session.context_data || {}) as ConversationContext;
      if (sessionCtx.last_referenced_entity) {
        const entityAge = sessionCtx.entity_referenced_at
          ? Date.now() - new Date(sessionCtx.entity_referenced_at).getTime()
          : Infinity;
        if (entityAge < 10 * 60 * 1000) {
          console.log('[Context] Resolving pronoun via session last_referenced_entity:', sessionCtx.last_referenced_entity.summary);
          const { data: entityTask } = await supabase
            .from('clerk_notes')
            .select('id, summary, priority, completed, task_owner, author_id, couple_id, due_date, reminder_time')
            .eq('id', sessionCtx.last_referenced_entity.id)
            .eq('completed', false)
            .maybeSingle();
          if (entityTask) {
            foundTask = entityTask;
          }
        }
      }
    }

    // 4. Recent outbound context fallback.
    if (!foundTask) {
      try {
        const recentOutbound = await getRecentOutboundMessages(supabase, userId);
        if (recentOutbound.length > 0) {
          console.log('[Context] No task found by target, checking recent outbound context...');
          for (const outMsg of recentOutbound) {
            const extracted = extractTaskFromOutbound(outMsg);
            if (extracted) {
              const contextTask = await semanticTaskSearch(supabase, userId, coupleId, extracted, generateEmbedding);
              if (contextTask) {
                console.log('[Context] Found task via outbound context:', contextTask.summary);
                foundTask = contextTask;
                break;
              }
            }
          }
        }
      } catch (obErr) {
        console.warn('[Context] Recent outbound lookup failed:', obErr);
      }
    }

    // ========================================================================
    // COMPOUND CREATE+REMIND: remind intent + no existing task → create new
    // note first, then set the reminder on it.
    // ========================================================================
    if (!foundTask && actionType === 'remind') {
      console.log('[TASK_ACTION] Remind intent but no existing task found — creating new note first');

      let taskDescription = messageBody || actionTarget || '';
      taskDescription = taskDescription
        .replace(/\s*[-–—]\s*remind\s+me\s+(?:to\s+)?(?:check\s+(?:it\s+)?out\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
        .replace(/\s*[-–—]\s*ricordami\s+(?:di\s+)?.*$/i, '')
        .replace(/\s*[-–—]\s*recuérdame\s+(?:de\s+)?.*$/i, '')
        .replace(/\s*remind\s+me\s+(?:about\s+)?(?:this\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
        .replace(/\s*remind\s+me\s+(?:to\s+)?(?:check\s+(?:it\s+)?out\s+)?(?:on|at|in|tomorrow|next|this).*$/i, '')
        .replace(/\s*ricordami\s+(?:di\s+)?.*$/i, '')
        .replace(/\s*recuérdame\s+(?:de\s+)?.*$/i, '')
        .trim();

      if (!taskDescription) {
        taskDescription = actionTarget || messageBody || 'New reminder';
      }

      console.log('[TASK_ACTION] Creating note with description:', taskDescription);

      try {
        const { data: processData, error: processError } = await supabase.functions.invoke('process-note', {
          body: {
            text: taskDescription,
            user_id: userId,
            couple_id: effectiveCoupleId,
            timezone: profile.timezone || 'America/New_York',
            language: userLang,
          },
        });

        if (processError) {
          console.error('[TASK_ACTION] process-note error:', processError);
          return { text: t('error_generic', userLang) };
        }

        const reminderExpr = effectiveMessage || messageBody || '';
        const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York', userLang);

        const eventDueDate = parsed.date || processData.due_date || null;

        let reminderTime = parsed.date || null;
        if (!reminderTime && eventDueDate) {
          const eventDate = new Date(eventDueDate);
          const hoursUntilEvent = (eventDate.getTime() - Date.now()) / (1000 * 60 * 60);

          if (hoursUntilEvent <= 4) {
            reminderTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          } else if (hoursUntilEvent <= 24) {
            reminderTime = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000).toISOString();
          } else {
            const morningOf = new Date(eventDate);
            morningOf.setUTCHours(9, 0, 0, 0);
            try {
              const utcStr = morningOf.toLocaleString('en-US', { timeZone: 'UTC' });
              const tzStr = morningOf.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
              const utcDate = new Date(utcStr);
              const tzDate = new Date(tzStr);
              const offsetMs = utcDate.getTime() - tzDate.getTime();
              reminderTime = new Date(morningOf.getTime() + offsetMs).toISOString();
            } catch {
              reminderTime = morningOf.toISOString();
            }
          }
        }

        const { data: insertedNote, error: insertError } = await insertNote(supabase, {
          author_id: userId,
          couple_id: effectiveCoupleId,
          source: inboundNoteSource,
          source_ref: wamid,
          original_text: messageBody || taskDescription,
          summary: processData.summary || taskDescription,
          category: processData.category || 'Task',
          due_date: eventDueDate,
          reminder_time: reminderTime,
          priority: processData.priority || 'medium',
          tags: processData.tags || [],
          items: processData.items || [],
          list_id: processData.list_id || null,
          media_urls: mediaUrls.length > 0 ? mediaUrls : null,
          completed: false,
        });

        if (insertError || !insertedNote) {
          console.error('[TASK_ACTION] Insert error:', insertError);
          return { text: t('error_generic', userLang) };
        }

        let listName = 'Tasks';
        if (insertedNote.list_id) {
          const { data: list } = await supabase
            .from('clerk_lists')
            .select('name')
            .eq('id', insertedNote.list_id)
            .single();
          if (list) listName = list.name;
        }

        const userTz = profile.timezone || 'America/New_York';
        const friendlyDate = reminderTime
          ? formatFriendlyDate(reminderTime, true, userTz, userLang)
          : eventDueDate
            ? formatFriendlyDate(eventDueDate, true, userTz, userLang)
            : parseNaturalDate('tomorrow', userTz, userLang).readable;

        const insertedSummary = insertedNote.summary ?? '';
        const confirmationMessage = [
          t('note_saved', userLang, { summary: insertedSummary }),
          t('note_added_to', userLang, { list: listName }),
          t('note_reminder_set', userLang, { date: friendlyDate }),
          ``,
          t('note_manage', userLang),
        ].join('\n');

        await saveReferencedEntity(
          { id: insertedNote.id, summary: insertedSummary, list_id: insertedNote.list_id || undefined },
          confirmationMessage,
        );

        return { text: confirmationMessage };
      } catch (createErr) {
        console.error('[TASK_ACTION] Create+remind error:', createErr);
        return { text: t('error_generic', userLang) };
      }
    }

    if (!foundTask && !actionTarget) {
      return { text: t('task_need_target', userLang) };
    }

    if (!foundTask) {
      if (isPronoun) {
        return { text: t('task_pronoun_unclear', userLang) };
      }
      if (weakCandidate) {
        const offerCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_DISAMBIGUATION',
            context_data: {
              ...offerCtx,
              pending_action: {
                type: actionType,
                candidates: [{ id: weakCandidate.id, summary: weakCandidate.summary }],
                original_query: actionTarget,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        console.log(
          `[TASK_ACTION] Offered weak candidate "${weakCandidate.summary}" via AWAITING_DISAMBIGUATION`,
        );
        return { text: t('task_did_you_mean', userLang, { task: weakCandidate.summary }) };
      }
      return { text: t('task_not_found', userLang, { query: actionTarget }) };
    }

    // Focal-entity stamp: mark the resolved task as the session's focal
    // entity so the next turn's pronouns ("it"/"that") resolve here. Use
    // saveReferencedEntity (with empty oliveResponse) so the webhook's
    // _lastReferencedTaskId closure var is also updated — same behavior as
    // the monolith's inline stamp + the closure-var assignment.
    try {
      await saveReferencedEntity(foundTask, '');
    } catch (stampErr) {
      console.warn(
        '[TASK_ACTION] focal-entity stamp failed (non-fatal):',
        stampErr instanceof Error ? stampErr.message : stampErr,
      );
    }

    // ========================================================================
    // C. Action switch
    // ========================================================================
    switch (actionType) {
      case 'complete': {
        const { error } = await supabase
          .from('clerk_notes')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', foundTask.id);

        if (error) {
          return { text: t('error_generic', userLang) };
        }

        const completeResponse = t('task_completed', userLang, { task: foundTask.summary });
        await saveReferencedEntity(foundTask, completeResponse);
        return { text: completeResponse };
      }

      case 'set_priority': {
        const msgLower = (effectiveMessage || '').toLowerCase();
        const newPriority = msgLower.includes('low') ? 'low' : 'high';
        const { error } = await supabase
          .from('clerk_notes')
          .update({ priority: newPriority, updated_at: new Date().toISOString() })
          .eq('id', foundTask.id);

        if (error) {
          return { text: t('error_generic', userLang) };
        }

        const emoji = newPriority === 'high' ? '🔥' : '📌';
        const priorityResponse = t('priority_updated', userLang, { emoji, task: foundTask.summary, priority: newPriority });
        await saveReferencedEntity({ ...foundTask, priority: newPriority }, priorityResponse);
        return { text: priorityResponse };
      }

      case 'set_due': {
        const dateExpr = effectiveMessage || 'tomorrow';
        const userTz = profile.timezone || 'America/New_York';
        const parsed = parseNaturalDate(dateExpr, userTz, userLang);

        // Time-only updates: "fai alle 8" / "change it to 7 AM" → keep
        // existing date, update time-of-day in user's timezone.
        if (!parsed.date && foundTask.due_date) {
          const timeOnly = extractTimeOnly(dateExpr);
          if (timeOnly) {
            const existingDate = new Date(foundTask.due_date);
            const localParts = getTimeZoneParts(existingDate, userTz);
            const newDate = toUtcFromLocalParts(
              { ...localParts, hour: timeOnly.hours, minute: timeOnly.minutes, second: 0 },
              userTz,
            );
            parsed.date = newDate.toISOString();
            parsed.readable = formatFriendlyDate(parsed.date, true, userTz, userLang);
            console.log(
              '[Context] Time-only update: keeping date, setting time to',
              `${timeOnly.hours.toString().padStart(2, '0')}:${timeOnly.minutes.toString().padStart(2, '0')}`,
              `(${userTz})`,
            );
          }
        }

        if (!parsed.date) {
          const timeOnly = extractTimeOnly(dateExpr);
          if (timeOnly) {
            const todayLocal = getTimeZoneParts(new Date(), userTz);
            const newDate = toUtcFromLocalParts(
              { ...todayLocal, hour: timeOnly.hours, minute: timeOnly.minutes, second: 0 },
              userTz,
            );
            parsed.date = newDate.toISOString();
            parsed.readable = formatFriendlyDate(parsed.date, true, userTz, userLang);
            console.log(
              '[Context] Time-only update: using today with time',
              `${timeOnly.hours.toString().padStart(2, '0')}:${timeOnly.minutes.toString().padStart(2, '0')}`,
              `(${userTz})`,
            );
          }
        }

        if (!parsed.date) {
          return { text: t('date_unparseable', userLang, { expr: dateExpr }) };
        }

        const currentCtx = (session.context_data || {}) as ConversationContext;
        const setDueTz = profile.timezone || 'America/New_York';
        let setDueConflicts: ConflictSummary[] = [];
        try {
          const setDueHasTime = /\d{1,2}:\d{2}|\bat\s+\d/i.test(parsed.readable || '');
          const setDueEnd = setDueHasTime
            ? new Date(new Date(parsed.date).getTime() + 60 * 60 * 1000).toISOString()
            : parsed.date;
          setDueConflicts = await findConflicts(supabase, {
            userId,
            proposedStart: parsed.date,
            proposedEnd: setDueEnd,
            proposedAllDay: !setDueHasTime,
            excludeNoteId: foundTask.id,
          });
        } catch (cfErr) {
          console.warn('[set_due] conflict detection failed (non-fatal):', cfErr);
        }

        let setDuePatterns: MatchedPattern[] = [];
        try {
          setDuePatterns = await findMatchingPatterns(supabase, {
            userId,
            proposedIso: parsed.date,
            timezone: setDueTz,
          });
        } catch (pErr) {
          console.warn('[set_due] pattern lookup failed (non-fatal):', pErr);
        }

        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...currentCtx,
              pending_action: {
                type: 'set_due_date',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                date: parsed.date,
                readable: parsed.readable,
                prior_due_date: foundTask.due_date || null,
                prior_reminder_time: foundTask.reminder_time || null,
                timezone: setDueTz,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        return {
          text: t('confirm_set_due', userLang, { task: foundTask.summary, when: parsed.readable })
            + buildWhatsAppConflictSuffix(setDueConflicts, userLang, setDueTz)
            + buildWhatsAppPatternSuffix(setDuePatterns, userLang),
        };
      }

      case 'assign': {
        if (!coupleId) {
          return { text: t('partner_no_space', userLang) };
        }

        const { data: partnerMember } = await supabase
          .from('clerk_couple_members')
          .select('user_id')
          .eq('couple_id', coupleId)
          .neq('user_id', userId)
          .limit(1)
          .single();

        if (!partnerMember) {
          return { text: t('partner_no_space', userLang) };
        }

        const { data: coupleData } = await supabase
          .from('clerk_couples')
          .select('you_name, partner_name, created_by')
          .eq('id', coupleId)
          .single();

        const isCreator = coupleData?.created_by === userId;
        const partnerName = isCreator ? (coupleData?.partner_name || 'Partner') : (coupleData?.you_name || 'Partner');

        const assignCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...assignCtx,
              pending_action: {
                type: 'assign',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                target_user_id: partnerMember.user_id,
                target_name: partnerName,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        return { text: t('confirm_assign', userLang, { task: foundTask.summary, partner: partnerName }) };
      }

      case 'edit_title': {
        const newTitle = (effectiveMessage || '').trim();
        if (!newTitle) {
          return { text: t('edit_need_value', userLang) };
        }
        const editCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...editCtx,
              pending_action: {
                type: 'edit_title',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                new_title: newTitle,
                prior_summary: foundTask.summary,
                timezone: profile.timezone || 'America/New_York',
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        return { text: t('confirm_edit_title', userLang, { task: foundTask.summary, new_title: newTitle }) };
      }

      case 'edit_location': {
        const newLocation = (effectiveMessage || '').trim();
        if (!newLocation) {
          return { text: t('edit_need_value', userLang) };
        }
        const editCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...editCtx,
              pending_action: {
                type: 'edit_location',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                new_location: newLocation,
                timezone: profile.timezone || 'America/New_York',
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        return { text: t('confirm_edit_location', userLang, { task: foundTask.summary, new_location: newLocation }) };
      }

      case 'edit_description': {
        const newDescription = (effectiveMessage || '').trim();
        if (!newDescription) {
          return { text: t('edit_need_value', userLang) };
        }
        const editCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...editCtx,
              pending_action: {
                type: 'edit_description',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                new_description: newDescription,
                prior_description: foundTask.original_text ?? null,
                timezone: profile.timezone || 'America/New_York',
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        return {
          text: t('confirm_edit_description', userLang, {
            task: foundTask.summary,
            new_description: newDescription.length > 60 ? newDescription.slice(0, 60) + '…' : newDescription,
          }),
        };
      }

      case 'edit_duration': {
        const raw = (effectiveMessage || '').trim();
        const parsedMinutes = parseInt(raw, 10);
        if (!parsedMinutes || parsedMinutes <= 0) {
          return { text: t('edit_need_value', userLang) };
        }
        const editCtx = (session.context_data || {}) as ConversationContext;
        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...editCtx,
              pending_action: {
                type: 'edit_duration',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                new_duration_minutes: parsedMinutes,
                timezone: profile.timezone || 'America/New_York',
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);
        return {
          text: t('confirm_edit_duration', userLang, {
            task: foundTask.summary,
            minutes: String(parsedMinutes),
          }),
        };
      }

      case 'delete': {
        const deleteCtx = (session.context_data || {}) as ConversationContext;

        let restoredRow: Record<string, unknown> | null = null;
        try {
          const { data: rowSnap } = await supabase
            .from('clerk_notes')
            .select('id, author_id, space_id, summary, original_text, due_date, reminder_time, priority, list_id, completed, category, is_sensitive, created_at')
            .eq('id', foundTask.id)
            .maybeSingle();
          restoredRow = rowSnap || null;
        } catch (snapErr) {
          console.warn('[delete-offer] failed to snapshot row for undo:', snapErr);
        }

        let linkedGoogleEventId: string | null = null;
        try {
          const { data: cal } = await supabase
            .from('calendar_events')
            .select('google_event_id')
            .eq('note_id', foundTask.id)
            .maybeSingle();
          linkedGoogleEventId = cal?.google_event_id ?? null;
        } catch { /* ignore */ }

        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...deleteCtx,
              pending_action: {
                type: 'delete',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                prior_due_date: foundTask.due_date || null,
                prior_reminder_time: foundTask.reminder_time || null,
                restored_row: restoredRow,
                google_event_id: linkedGoogleEventId,
                timezone: profile.timezone || 'America/New_York',
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        return { text: t('confirm_delete', userLang, { task: foundTask.summary }) };
      }

      case 'move': {
        const targetListName = (effectiveMessage || '').trim();

        if (!targetListName) {
          return { text: t('move_need_list_name', userLang) };
        }

        let listsQuery = supabase
          .from('clerk_lists')
          .select('id, name');

        if (coupleId) {
          listsQuery = listsQuery.or(`author_id.eq.${userId},couple_id.eq.${coupleId}`);
        } else {
          listsQuery = listsQuery.eq('author_id', userId);
        }

        const { data: allLists } = await listsQuery;

        let existingList: { id: string; name: string } | null = null;
        const targetLower = targetListName.toLowerCase().trim();

        if (allLists && allLists.length > 0) {
          existingList = allLists.find((l: { name: string }) => l.name.toLowerCase().trim() === targetLower) || null;

          if (!existingList) {
            existingList = allLists.find((l: { name: string }) => l.name.toLowerCase().trim().startsWith(targetLower)) || null;
          }

          if (!existingList) {
            existingList = allLists.find((l: { name: string }) => {
              const listLower = l.name.toLowerCase().trim();
              return listLower.includes(targetLower) || targetLower.includes(listLower);
            }) || null;
          }
        }

        console.log(`[MOVE] Target: "${targetListName}" | Found: ${existingList ? `"${existingList.name}" (${existingList.id})` : 'NONE'} | Total lists: ${allLists?.length || 0}`);

        if (existingList) {
          const { error } = await supabase
            .from('clerk_notes')
            .update({ list_id: existingList.id, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);

          if (!error) {
            const moveResponse = `📂 Moved "${foundTask.summary}" to ${existingList.name}!`;
            await saveReferencedEntity({ ...foundTask, list_id: existingList.id }, moveResponse);
            return { text: moveResponse };
          }
        }

        const { data: newList } = await supabase
          .from('clerk_lists')
          .insert({
            name: targetListName,
            author_id: userId,
            couple_id: effectiveCoupleId,
            is_manual: true,
          })
          .select('id, name')
          .single();

        if (newList) {
          await supabase
            .from('clerk_notes')
            .update({ list_id: newList.id, updated_at: new Date().toISOString() })
            .eq('id', foundTask.id);

          const moveResponse = `📂 Created "${newList.name}" list and moved "${foundTask.summary}" there!`;
          await saveReferencedEntity({ ...foundTask, list_id: newList.id }, moveResponse);
          return { text: moveResponse };
        }

        return { text: t('move_failed', userLang) };
      }

      case 'remind': {
        const reminderExpr = effectiveMessage || actionTarget || messageBody || '';
        console.log('[remind] reminderExpr:', reminderExpr, '| actionTarget:', actionTarget, '| effectiveMessage:', effectiveMessage);
        const parsed = parseNaturalDate(reminderExpr, profile.timezone || 'America/New_York', userLang);
        const remindCtx = (session.context_data || {}) as ConversationContext;

        if (parsed.date) {
          const remindTz = profile.timezone || 'America/New_York';
          let remindConflicts: ConflictSummary[] = [];
          try {
            const remindEnd = new Date(new Date(parsed.date).getTime() + 60 * 60 * 1000).toISOString();
            remindConflicts = await findConflicts(supabase, {
              userId,
              proposedStart: parsed.date,
              proposedEnd: remindEnd,
              excludeNoteId: foundTask.id,
            });
          } catch (cfErr) {
            console.warn('[remind] conflict detection failed (non-fatal):', cfErr);
          }

          let remindPatterns: MatchedPattern[] = [];
          try {
            remindPatterns = await findMatchingPatterns(supabase, {
              userId,
              proposedIso: parsed.date,
              timezone: remindTz,
            });
          } catch (pErr) {
            console.warn('[remind] pattern lookup failed (non-fatal):', pErr);
          }

          await supabase
            .from('user_sessions')
            .update({
              conversation_state: 'AWAITING_CONFIRMATION',
              context_data: {
                ...remindCtx,
                pending_action: {
                  type: 'set_reminder',
                  task_id: foundTask.id,
                  task_summary: foundTask.summary,
                  time: parsed.date,
                  readable: parsed.readable,
                  has_due_date: !!foundTask.due_date,
                  prior_due_date: foundTask.due_date || null,
                  prior_reminder_time: foundTask.reminder_time || null,
                  timezone: remindTz,
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id);

          return {
            text: t('confirm_set_reminder', userLang, { task: foundTask.summary, when: parsed.readable })
              + buildWhatsAppConflictSuffix(remindConflicts, userLang, remindTz)
              + buildWhatsAppPatternSuffix(remindPatterns, userLang),
          };
        }

        // SMART REMINDER DEFAULTS: based on task's due_date.
        const taskDueDate = foundTask.due_date ? new Date(foundTask.due_date) : null;
        let smartReminderDate: Date;
        let smartReadable: string;

        if (taskDueDate && taskDueDate.getTime() > Date.now()) {
          const hoursUntilDue = (taskDueDate.getTime() - Date.now()) / (1000 * 60 * 60);
          const dueHour = taskDueDate.getUTCHours();

          if (hoursUntilDue <= 4) {
            smartReminderDate = new Date(Date.now() + 30 * 60 * 1000);
            smartReadable = t('smart_reminder_30min', userLang);
          } else if (hoursUntilDue <= 24) {
            smartReminderDate = new Date(taskDueDate.getTime() - 2 * 60 * 60 * 1000);
            smartReadable = t('smart_reminder_2h_before', userLang);
          } else {
            smartReminderDate = new Date(taskDueDate);
            smartReminderDate.setUTCHours(9, 0, 0, 0);
            try {
              const utcStr = smartReminderDate.toLocaleString('en-US', { timeZone: 'UTC' });
              const tzStr = smartReminderDate.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
              const utcDate = new Date(utcStr);
              const tzDate = new Date(tzStr);
              const offsetMs = utcDate.getTime() - tzDate.getTime();
              smartReminderDate = new Date(smartReminderDate.getTime() + offsetMs);
            } catch { /* keep as-is */ }

            if (dueHour >= 13) {
              const eveningBefore = new Date(taskDueDate);
              eveningBefore.setDate(eveningBefore.getDate() - 1);
              eveningBefore.setUTCHours(20, 0, 0, 0);
              try {
                const utcStr = eveningBefore.toLocaleString('en-US', { timeZone: 'UTC' });
                const tzStr = eveningBefore.toLocaleString('en-US', { timeZone: profile.timezone || 'America/New_York' });
                const utcDate = new Date(utcStr);
                const tzDate = new Date(tzStr);
                const offsetMs = utcDate.getTime() - tzDate.getTime();
                smartReminderDate = new Date(eveningBefore.getTime() + offsetMs);
              } catch { /* keep as-is */ }
              smartReadable = t('smart_reminder_evening_morning', userLang);
            } else {
              smartReadable = t('smart_reminder_morning_of', userLang);
            }
          }
        } else {
          smartReminderDate = new Date();
          smartReminderDate.setDate(smartReminderDate.getDate() + 1);
          smartReminderDate.setHours(9, 0, 0, 0);
          smartReadable = t('smart_reminder_tomorrow_9am', userLang);
        }

        await supabase
          .from('user_sessions')
          .update({
            conversation_state: 'AWAITING_CONFIRMATION',
            context_data: {
              ...remindCtx,
              pending_action: {
                type: 'set_reminder',
                task_id: foundTask.id,
                task_summary: foundTask.summary,
                time: smartReminderDate.toISOString(),
                readable: smartReadable,
                has_due_date: !!foundTask.due_date,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id);

        return { text: t('confirm_set_reminder', userLang, { task: foundTask.summary, when: smartReadable }) };
      }

      default:
        return { text: t('task_action_unknown', userLang) };
    }
  };
}
