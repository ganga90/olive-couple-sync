// handlers/partner-message.ts — PARTNER_MESSAGE intent handler.
// ============================================================================
// Initiative 1.7 of OLIVE_REFACTOR_PLAN.md. Handles "remind/tell/ask
// <partner> to <X>" relays. Three independent moving parts:
//   1. **Resolve partner**: get_space_members RPC + phone-number lookup.
//   2. **Dedupe + maybe-create task**: vector similarity (find_similar_notes)
//      → textSearch fallback. If a duplicate exists, skip creation and
//      just relay the message; otherwise process-note + insertNote +
//      embedding.
//   3. **Send via Meta directly** (no gateway): free-form text first;
//      on Meta error 131047 (outside 24h window), fall back to the
//      `olive_task_reminder` template.
//   4. **Trust gate**: `send_whatsapp_to_partner` action checked
//      before sending. Blocked replies show a queued message.
//   5. **Outbound queue log** + saveReferencedEntity on success.

import { insertNote } from "../../_shared/note-insert.ts";
import { checkTrustForAction } from "../../_shared/trust-gate-check.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type { Handler, HandlerContext, Reply } from "../../_shared/types.ts";
import type { SaveReferencedEntityFn } from "./contextual-ask.ts";

// ─── Types ─────────────────────────────────────────────────────────────

/** Subset of `fetch` we use to call Meta directly. Test stubs supply
 *  scripted responses. Defaults to the global `fetch`. */
export type MetaFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface PartnerMessageDeps {
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  generateEmbedding: (text: string) => Promise<number[] | null>;
  saveReferencedEntity: SaveReferencedEntityFn;
  /** Optional fetch override for tests. Defaults to global `fetch`. */
  metaFetch?: MetaFetchFn;
  /** Optional env overrides for tests. */
  env?: {
    WHATSAPP_ACCESS_TOKEN?: string;
    WHATSAPP_PHONE_NUMBER_ID?: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

const TASK_VERBS_RE = /\b(buy|get|pick\s*up|call|book|make|schedule|clean|fix|do|send|bring|take|remind|check|prepare|pay|return|cancel|organize|plan|cook|wash|set\s*up|drop\s*off|arrange|confirm|order|submit|review|renew|update|finish|complete|collect|deliver|move|pack|comprar|llamar|hacer|enviar|traer|pagar|limpiar|cocinar|preparar|organizar|recoger|devolver|comprare|chiamare|fare|inviare|portare|pagare|pulire|cucinare|preparare|organizzare|raccogliere|restituire)\b/i;

/** Decides whether a partner relay should also create a task in the
 *  shared space. `remind` + `notify` always do; for `tell`/`ask`, look
 *  for action verbs. Exported for unit testing. */
export function isTaskLikeRelay(action: string, content: string): boolean {
  if (action === 'remind' || action === 'notify') return true;
  return TASK_VERBS_RE.test(content);
}

const STOP_WORDS = new Set([
  'a','an','the','to','of','in','for','and','or','is','it','my','me','i','that','this','her','his','our',
  'un','una','il','la','le','lo','di','da','per','che','del','al','el','de','en','por','su','con',
]);
const ACTION_VERBS_FOR_KEYWORD_MATCH = new Set([
  'check','remind','tell','ask','notify','make','do','get','send','dile','ricorda','dì','chiedi',
]);

// ─── Internal: partner resolution ──────────────────────────────────────

interface ResolvedPartner {
  partnerId: string;
  partnerName: string;
  partnerPhone: string;
  partnerLast4: string;
  partnerLastMsgAt: string | null;
  senderName: string;
}

async function resolvePartner(
  ctx: HandlerContext,
): Promise<ResolvedPartner | { error: 'no_space' | 'no_phone'; partnerName?: string }> {
  if (!ctx.coupleId) return { error: 'no_space' };

  const { data: spaceMembers } = await ctx.supabase.rpc('get_space_members', {
    p_couple_id: ctx.coupleId,
  });
  if (!spaceMembers || spaceMembers.length === 0) return { error: 'no_space' };

  // deno-lint-ignore no-explicit-any
  const currentMember = spaceMembers.find((m: any) => m.user_id === ctx.userId);
  // deno-lint-ignore no-explicit-any
  const otherMembers = spaceMembers.filter((m: any) => m.user_id !== ctx.userId);
  if (otherMembers.length === 0) return { error: 'no_space' };

  // deno-lint-ignore no-explicit-any
  const otherUserIds = otherMembers.map((m: any) => m.user_id);
  const { data: candidateProfiles } = await ctx.supabase
    .from('clerk_profiles')
    .select('id, phone_number, display_name, last_user_message_at')
    .in('id', otherUserIds);

  // deno-lint-ignore no-explicit-any
  const partnerProfile = candidateProfiles?.find((p: any) => p.phone_number)
    || candidateProfiles?.[0]
    || null;
  if (!partnerProfile) return { error: 'no_space' };

  // deno-lint-ignore no-explicit-any
  const partnerMemberRecord = otherMembers.find((m: any) => m.user_id === partnerProfile.id);
  const partnerName = partnerMemberRecord?.display_name || partnerProfile.display_name || 'Partner';

  if (!partnerProfile.phone_number) {
    return { error: 'no_phone', partnerName };
  }

  return {
    partnerId: partnerProfile.id,
    partnerName,
    partnerPhone: partnerProfile.phone_number,
    partnerLast4: partnerProfile.phone_number.slice(-4),
    partnerLastMsgAt: partnerProfile.last_user_message_at,
    senderName: currentMember?.display_name || 'Your partner',
  };
}

// ─── Internal: duplicate detection ─────────────────────────────────────

/** Two-layer dedupe: vector similarity (threshold 0.80) → textSearch
 *  keyword overlap (ratio ≥ 0.40). Returns the matched note or null. */
async function findDuplicateTask(
  ctx: HandlerContext,
  content: string,
  generateEmbedding: (text: string) => Promise<number[] | null>,
): Promise<{ id: string; summary: string } | null> {
  // Layer 1: vector similarity.
  try {
    const queryEmbedding = await generateEmbedding(content);
    if (queryEmbedding) {
      const { data: similar } = await ctx.supabase.rpc('find_similar_notes', {
        p_user_id: ctx.userId,
        p_couple_id: ctx.coupleId,
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_threshold: 0.80,
        p_limit: 3,
      });
      if (similar && similar.length > 0) {
        console.log('[PARTNER_MESSAGE] 🔍 Vector duplicate found:', similar[0].summary, '| similarity:', similar[0].similarity);
        return { id: similar[0].id, summary: similar[0].summary };
      }
    }
  } catch (vecErr) {
    console.error('[PARTNER_MESSAGE] Vector duplicate check failed (non-blocking):', vecErr);
  }

  // Layer 2: keyword fallback via textSearch.
  try {
    const keywords = content
      .toLowerCase()
      .replace(/[^\w\sáéíóúñàèìòù]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (keywords.length === 0) return null;

    const searchQuery = keywords.slice(0, 4).join(' OR ');
    const { data: keywordMatches } = await ctx.supabase
      .from('clerk_notes')
      .select('id, summary, original_text')
      .eq('completed', false)
      .or(`couple_id.eq.${ctx.coupleId},and(author_id.eq.${ctx.userId},couple_id.is.null)`)
      .textSearch('summary', searchQuery, { type: 'websearch' })
      .limit(5);
    if (!keywordMatches || keywordMatches.length === 0) return null;

    const contentKeywords = keywords.filter((k) => !ACTION_VERBS_FOR_KEYWORD_MATCH.has(k));
    const matchKeywords = contentKeywords.length >= 2 ? contentKeywords : keywords;

    const bestMatch = keywordMatches
      // deno-lint-ignore no-explicit-any
      .map((m: any) => {
        const mWords = new Set(
          (m.summary + ' ' + (m.original_text || '')).toLowerCase().split(/\s+/).map((w: string) => w.replace(/[^\w]/g, '')),
        );
        const overlap = matchKeywords.filter((k) => mWords.has(k)).length;
        return { ...m, overlap, ratio: overlap / matchKeywords.length };
      })
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => b.ratio - a.ratio)[0];

    if (bestMatch && bestMatch.ratio >= 0.4) {
      console.log('[PARTNER_MESSAGE] 🔍 Keyword duplicate found:', bestMatch.summary, '| overlap:', bestMatch.ratio);
      return { id: bestMatch.id, summary: bestMatch.summary };
    }
  } catch (kwErr) {
    console.error('[PARTNER_MESSAGE] Keyword duplicate check failed (non-blocking):', kwErr);
  }
  return null;
}

// ─── Internal: task creation ───────────────────────────────────────────

async function createPartnerTask(
  ctx: HandlerContext,
  partnerId: string,
  partnerAction: string,
  content: string,
  generateEmbedding: (text: string) => Promise<number[] | null>,
): Promise<{ id: string; summary: string } | null> {
  try {
    const { data: processData, error: processErr } = await ctx.supabase.functions.invoke('process-note', {
      body: {
        text: content,
        user_id: ctx.userId,
        couple_id: ctx.coupleId,
        timezone: ctx.profile.timezone || 'America/New_York',
        language: ctx.userLang,
        source: 'whatsapp',
      },
    });
    if (processErr) {
      console.error('[PARTNER_MESSAGE] process-note error:', processErr);
    }

    // deno-lint-ignore no-explicit-any
    const pd: any = processData;
    const { data: insertedNote, error: insertErr } = await insertNote(ctx.supabase, {
      author_id: ctx.userId,
      couple_id: ctx.coupleId,
      source: 'partner-relay',
      source_ref: `partner_relay:${partnerAction}`,
      original_text: content,
      summary: pd?.summary || content,
      category: pd?.category || 'task',
      due_date: pd?.due_date || null,
      reminder_time: pd?.reminder_time || null,
      recurrence_frequency: pd?.recurrence_frequency || null,
      recurrence_interval: pd?.recurrence_interval || null,
      priority: pd?.priority || 'medium',
      tags: pd?.tags || [],
      items: pd?.items || [],
      task_owner: partnerId,
      list_id: pd?.list_id || null,
      completed: false,
    });

    if (insertErr) {
      console.error('[PARTNER_MESSAGE] Note insert error:', insertErr.message, (insertErr as { details?: string }).details);
      return null;
    }
    if (!insertedNote) return null;
    const summary = insertedNote.summary ?? '';
    console.log('[PARTNER_MESSAGE] ✅ Created task for partner:', summary, '| list_id:', insertedNote.list_id);

    // Embedding (non-blocking).
    try {
      const embedding = await generateEmbedding(summary);
      if (embedding) {
        await ctx.supabase
          .from('clerk_notes')
          .update({ embedding: JSON.stringify(embedding) })
          .eq('id', insertedNote.id);
        console.log('[PARTNER_MESSAGE] Embedding saved for task:', insertedNote.id);
      }
    } catch (embErr) {
      console.error('[PARTNER_MESSAGE] Embedding error (non-blocking):', embErr);
    }
    return { id: insertedNote.id, summary };
  } catch (taskErr) {
    console.error('[PARTNER_MESSAGE] Error creating task (non-blocking):', taskErr);
    return null;
  }
}

// ─── Internal: Meta send ───────────────────────────────────────────────

interface SendResult {
  sent: boolean;
  error: string;
}

async function sendViaMeta(
  fetchFn: MetaFetchFn,
  accessToken: string,
  phoneNumberId: string,
  partnerPhone: string,
  message: string,
  senderName: string,
  fallbackContent: string,
): Promise<SendResult> {
  const cleanPartnerNumber = partnerPhone.replace(/\D/g, '');
  const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  // ── Free-form first.
  try {
    const freeFormRes = await fetchFn(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPartnerNumber,
        type: 'text',
        text: { preview_url: true, body: message },
      }),
    });
    const freeFormBody = await freeFormRes.text();
    console.log('[PARTNER_MESSAGE] Free-form response:', freeFormRes.status, freeFormBody.substring(0, 300));

    if (freeFormRes.ok) {
      try {
        const data = JSON.parse(freeFormBody);
        console.log('[PARTNER_MESSAGE] ✅ Free-form sent! Meta message_id:', data.messages?.[0]?.id || '');
      } catch {
        /* ignore parse error — send succeeded */
      }
      return { sent: true, error: '' };
    }

    // Check for 131047 (outside 24h window) → template fallback.
    let errorCode: number | undefined;
    let errorSubcode: number | undefined;
    try {
      const errorData = JSON.parse(freeFormBody);
      errorCode = errorData?.error?.code;
      errorSubcode = errorData?.error?.error_subcode;
    } catch {
      /* fall through */
    }
    console.log('[PARTNER_MESSAGE] Free-form failed. Code:', errorCode, 'Subcode:', errorSubcode);

    if (errorCode === 131047 || errorSubcode === 131047 || freeFormBody.includes('131047')) {
      console.log('[PARTNER_MESSAGE] Outside 24h window → trying template message');
      const templateRes = await fetchFn(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPartnerNumber,
          type: 'template',
          template: {
            name: 'olive_task_reminder',
            language: { code: 'en' },
            components: [{
              type: 'body',
              parameters: [
                { type: 'text', text: `Message from ${senderName}` },
                { type: 'text', text: fallbackContent.substring(0, 800) },
              ],
            }],
          },
        }),
      });
      const templateBody = await templateRes.text();
      console.log('[PARTNER_MESSAGE] Template response:', templateRes.status, templateBody.substring(0, 300));
      if (templateRes.ok) {
        return { sent: true, error: '' };
      }
      return { sent: false, error: `Template failed (${templateRes.status}): ${templateBody.substring(0, 200)}` };
    }

    return { sent: false, error: `Free-form failed (${freeFormRes.status}): ${freeFormBody.substring(0, 200)}` };
  } catch (sendErr) {
    return { sent: false, error: `Send exception: ${String(sendErr)}` };
  }
}

// ─── Internal: outbound queue log ──────────────────────────────────────

async function logOutbound(
  ctx: HandlerContext,
  partnerId: string,
  message: string,
  sent: boolean,
  sendError: string,
): Promise<void> {
  try {
    await ctx.supabase.from('olive_outbound_queue').insert({
      user_id: partnerId,
      message_type: 'partner_notification',
      content: message,
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
      error_message: sent ? null : sendError,
      priority: 'normal',
    });
  } catch (logErr) {
    console.error('[PARTNER_MESSAGE] Log insert error (non-critical):', logErr);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makePartnerMessageHandler(deps: PartnerMessageDeps): Handler {
  const fetchFn = deps.metaFetch ?? ((url, init) => fetch(url, init));

  return async (ctx: HandlerContext): Promise<Reply> => {
    // deno-lint-ignore no-explicit-any
    const intentResultAny = ctx.intentResult as any;
    const partnerAction = (intentResultAny._partnerAction as string) || 'tell';
    const partnerMessageContent = ctx.cleanMessage || ctx.effectiveMessage || '';
    console.log('[PARTNER_MESSAGE] Processing:', partnerAction, '→', partnerMessageContent?.substring(0, 80));

    // ── Resolve partner.
    const resolved = await resolvePartner(ctx);
    if ('error' in resolved) {
      if (resolved.error === 'no_phone') {
        return { text: deps.t('partner_no_phone', ctx.userLang, { partner: resolved.partnerName || 'Partner' }) };
      }
      return { text: deps.t('partner_no_space', ctx.userLang) };
    }
    const { partnerId, partnerName, partnerPhone, partnerLast4, partnerLastMsgAt, senderName } = resolved;
    console.log('[PARTNER_MESSAGE] Resolved: sender=' + senderName + ', partner=' + partnerName + ', partnerId=' + partnerId?.substring(0, 15));
    console.log('[PARTNER_MESSAGE] Partner phone ends in:', partnerLast4);

    // ── Decide whether to create a task.
    const wantsTask = isTaskLikeRelay(partnerAction, partnerMessageContent);
    console.log('[PARTNER_MESSAGE] isTaskLike:', wantsTask, '| partnerAction:', partnerAction);

    let savedTask: { id: string; summary: string } | null = null;
    let existingTaskFound = false;
    if (wantsTask) {
      const dup = await findDuplicateTask(ctx, partnerMessageContent, deps.generateEmbedding);
      if (dup) {
        savedTask = dup;
        existingTaskFound = true;
        console.log('[PARTNER_MESSAGE] ⏭️ Skipping creation — existing task:', dup.summary);
      } else {
        savedTask = await createPartnerTask(ctx, partnerId, partnerAction, partnerMessageContent, deps.generateEmbedding);
      }
    }

    // ── Compose the WhatsApp message to partner.
    const actionEmoji: Record<string, string> = {
      remind: '⏰',
      tell: '💬',
      ask: '❓',
      notify: '📢',
    };
    const emoji = actionEmoji[partnerAction] || '💬';

    let partnerWhatsAppMsg = '';
    if (partnerAction === 'remind') {
      partnerWhatsAppMsg = `${emoji} Reminder from ${senderName}:\n\n${savedTask?.summary || partnerMessageContent}\n\nReply "done" when finished 🫒`;
    } else if (partnerAction === 'ask') {
      partnerWhatsAppMsg = `${emoji} ${senderName} is asking:\n\n${partnerMessageContent}\n\nReply to let them know 🫒`;
    } else {
      partnerWhatsAppMsg = `${emoji} Message from ${senderName}:\n\n${savedTask?.summary || partnerMessageContent}\n\n🫒 Olive`;
    }

    // ── Trust gate.
    const partnerTrust = await checkTrustForAction(ctx.supabase, {
      userId: ctx.userId,
      actionType: 'send_whatsapp_to_partner',
      spaceId: ctx.coupleId || undefined,
      actionPayload: {
        partner_id: partnerId,
        partner_name: partnerName,
        message_preview: partnerWhatsAppMsg.slice(0, 200),
        saved_task_id: savedTask?.id || null,
      },
      actionDescription: `send a WhatsApp to ${partnerName}: "${partnerMessageContent.slice(0, 100)}"`,
      triggerType: 'reactive',
    });

    if (!partnerTrust.allowed) {
      console.log(
        `[PARTNER_MESSAGE] Trust gate ${partnerTrust.trust_level_name} blocked send`
          + ` — queued as ${partnerTrust.action_id}`,
      );
      if (savedTask) {
        return {
          text: `📋 I saved "${savedTask.summary}" and queued a message to ${partnerName} for your approval. Open Olive to confirm — or reply "do it" and I'll send it now.`,
        };
      }
      return {
        text: `✋ I've queued a message to ${partnerName} for your approval. Open Olive to confirm — or reply "do it" and I'll send it now.`,
      };
    }
    if (partnerTrust.failed_open) {
      console.warn('[PARTNER_MESSAGE] Trust gate failed open — proceeding with send');
    }

    // ── Window check (informational).
    const partnerIn24h = partnerLastMsgAt && (Date.now() - new Date(partnerLastMsgAt).getTime()) < 24 * 60 * 60 * 1000;
    console.log('[PARTNER_MESSAGE] Partner 24h window:', partnerIn24h ? 'INSIDE' : 'OUTSIDE', '| lastMsg:', partnerLastMsgAt || 'never');

    // ── Send via Meta directly.
    const accessToken = deps.env?.WHATSAPP_ACCESS_TOKEN ?? Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? '';
    const phoneNumberId = deps.env?.WHATSAPP_PHONE_NUMBER_ID ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
    console.log('[PARTNER_MESSAGE] Attempting free-form send to:', partnerPhone.replace(/\D/g, ''));

    const sendResult = await sendViaMeta(
      fetchFn, accessToken, phoneNumberId, partnerPhone,
      partnerWhatsAppMsg, senderName,
      savedTask?.summary || partnerMessageContent,
    );

    // ── Log outbound (non-critical).
    await logOutbound(ctx, partnerId, partnerWhatsAppMsg, sendResult.sent, sendResult.error);

    // ── Reply to sender + after_reply for saveReferencedEntity.
    if (!sendResult.sent) {
      if (savedTask) {
        return {
          text: deps.t('partner_reached_partial', ctx.userLang, {
            task: savedTask.summary, partner: partnerName, last4: partnerLast4,
          }),
        };
      }
      return {
        text: deps.t('partner_unreachable', ctx.userLang, {
          partner: partnerName,
          last4: partnerLast4,
          detail: sendResult.error ? 'Error: ' + sendResult.error.substring(0, 100) : 'Please try again later.',
        }),
      };
    }

    if (savedTask) {
      const templateKey = existingTaskFound ? 'partner_message_existing_task' : 'partner_message_and_task';
      const confirmResponse = deps.t(templateKey, ctx.userLang, {
        partner: partnerName,
        task: savedTask.summary,
      });
      const taskSnapshot = savedTask;
      const after_reply: Array<() => Promise<void>> = [
        async () => {
          try {
            await deps.saveReferencedEntity(taskSnapshot, confirmResponse);
          } catch (refErr) {
            console.warn('[PARTNER_MESSAGE] saveReferencedEntity failed (non-blocking):', refErr);
          }
        },
      ];
      return { text: confirmResponse, after_reply };
    }
    return {
      text: deps.t('partner_message_sent', ctx.userLang, {
        partner: partnerName,
        message: partnerMessageContent.substring(0, 200),
      }),
    };
  };
}
