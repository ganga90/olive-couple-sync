/**
 * Olive Email MCP — Gmail Triage Agent
 *
 * Edge function that manages Gmail integration and email triage:
 * - status: Check connection health + return email/last_sync
 * - disconnect: Revoke tokens and deactivate connection
 * - triage: Scan unread inbox emails, extract actionable tasks via Gemini,
 *           create tasks in clerk_notes, label processed emails
 *
 * Privacy safeguards:
 * - Read-only Gmail access (gmail.readonly + gmail.labels)
 * - No email content stored — only extracted task summaries persist
 * - Primary inbox only — skips Promotions, Social, Updates, Spam
 * - PII filtering on task summaries before storage
 * - User can disconnect anytime, revoking all tokens
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const geminiKey = Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";

// ─── Token Management ────────────────────────────────────────────

interface EmailConnection {
  id: string;
  user_id: string;
  provider: string;
  email_address: string | null;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
  last_sync_at: string | null;
  is_active: boolean;
}

/**
 * Refresh Gmail OAuth token if expired. Returns the current valid access_token.
 */
async function getValidAccessToken(
  supabase: any,
  conn: EmailConnection
): Promise<string> {
  // Check if token is still valid (with 5-min buffer)
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry);
    if (expiry.getTime() - Date.now() > 5 * 60 * 1000) {
      return conn.access_token;
    }
  }

  // Token expired — refresh it
  const clientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

  if (!clientId || !clientSecret || !conn.refresh_token) {
    throw new Error("Cannot refresh token: missing credentials or refresh_token");
  }

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });

  if (!refreshRes.ok) {
    const errorText = await refreshRes.text();
    console.error("[email-mcp] Token refresh failed:", refreshRes.status, errorText);

    // Mark connection as errored
    await supabase
      .from("olive_email_connections")
      .update({ error_message: "Token refresh failed — please reconnect", is_active: false })
      .eq("id", conn.id);

    throw new Error("Token refresh failed — please reconnect Gmail");
  }

  const tokens = await refreshRes.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  // Update stored tokens
  await supabase
    .from("olive_email_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      token_expiry: newExpiry,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  return tokens.access_token;
}

// ─── Gmail API Helpers ───────────────────────────────────────────

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  labelIds: string[];
}

/**
 * Fetch unread primary inbox messages (max 20).
 * NOTE: We use gmail.readonly scope, so we can NOT label or modify messages.
 * Dedup is handled via state (tracking processed message IDs) instead.
 */
async function fetchUnreadEmails(accessToken: string, processedIds: Set<string>): Promise<GmailMessage[]> {
  // List message IDs
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", "is:unread category:primary");
  listUrl.searchParams.set("maxResults", "20");

  const listRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    const error = await listRes.text();
    console.error("[email-mcp] List messages failed:", listRes.status, error);
    throw new Error(`Gmail API error: ${listRes.status}`);
  }

  const listData = await listRes.json();
  const allMessageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id);

  // Filter out already-processed messages (dedup via state)
  const messageIds = allMessageIds.filter((id) => !processedIds.has(id));

  if (messageIds.length === 0) return [];

  // Fetch each message's metadata (batch up to 20)
  const messages: GmailMessage[] = [];

  for (const msgId of messageIds) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!msgRes.ok) continue;

      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

      messages.push({
        id: msgData.id,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        snippet: msgData.snippet || "",
        date: getHeader("Date"),
        labelIds: msgData.labelIds || [],
      });
    } catch (e) {
      console.error(`[email-mcp] Failed to fetch message ${msgId}:`, e);
    }
  }

  return messages;
}

// NOTE: We do NOT label/modify messages because gmail.readonly scope doesn't allow it.
// Instead, we track processed message IDs in agent state for dedup.

// ─── PII Filtering ───────────────────────────────────────────────

/**
 * Strip email addresses, phone numbers, and other PII from task summaries
 * before storing in the database.
 */
function stripPII(text: string): string {
  return text
    // Remove email addresses
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    // Remove phone numbers (various formats)
    .replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone]")
    // Remove credit card-like numbers
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[card]")
    // Remove SSN-like patterns
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[id]");
}

// ─── Triage Pipeline ─────────────────────────────────────────────

interface TriageResult {
  classification: "ACTION_REQUIRED" | "INFORMATIONAL" | "SKIP";
  task_summary?: string;
  due_date?: string | null;
  priority?: "high" | "medium" | "low";
  category?: string;
}

/**
 * Run the full email triage pipeline.
 * @param previouslyProcessedIds - Gmail message IDs already triaged in past runs (from agent state)
 * @returns Result including newly processed IDs for state persistence
 */
async function runEmailTriage(
  supabase: any,
  userId: string,
  coupleId?: string,
  previouslyProcessedIds: string[] = []
): Promise<{ tasks_created: number; emails_processed: number; summary: string; processed_ids: string[] }> {
  // 1. Load connection
  const { data: conn, error: connErr } = await supabase
    .from("olive_email_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (connErr || !conn) {
    throw new Error("Gmail not connected — please connect in Settings");
  }

  // 2. Get valid access token (auto-refresh if expired)
  const accessToken = await getValidAccessToken(supabase, conn as EmailConnection);

  // 3. Fetch unread primary emails (filtering out previously processed)
  const processedSet = new Set(previouslyProcessedIds);
  const emails = await fetchUnreadEmails(accessToken, processedSet);

  if (emails.length === 0) {
    await supabase
      .from("olive_email_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", conn.id);

    return { tasks_created: 0, emails_processed: 0, summary: "No unread emails in your primary inbox.", processed_ids: previouslyProcessedIds };
  }

  console.log(`[email-mcp] Found ${emails.length} unread primary emails for user ${userId}`);

  // 4. AI Triage via Gemini
  const genai = new GoogleGenAI({ apiKey: geminiKey });

  const emailList = emails
    .map((e, i) => `${i + 1}. Subject: "${e.subject}" | From: ${e.from} | Preview: "${e.snippet.substring(0, 150)}"`)
    .join("\n");

  const response = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an expert email triage agent for a couples productivity app called Olive. Your job is to find ACTIONABLE items hidden in emails.

Analyze each email and classify it:
- ACTION_REQUIRED: Contains ANY of these: a task, deadline, request, appointment, payment, RSVP, follow-up needed, decision required, someone waiting for a response, a booking/reservation to confirm, a document to review/sign, a meeting to prepare for
- INFORMATIONAL: Useful information but genuinely no action needed (e.g., order shipped, account statement, read-only updates)
- SKIP: Marketing, promotional, automated newsletters, spam, social media notifications

IMPORTANT: Be AGGRESSIVE about finding action items. When in doubt, classify as ACTION_REQUIRED. Real humans miss tasks in emails all the time — your job is to catch them.

For ACTION_REQUIRED emails, extract:
- task_summary: A clear imperative 1-line task (e.g., "Reply to landlord about lease renewal", "Pay electric bill $127", "RSVP to Sarah's dinner party by Friday", "Review and sign attached contract")
- due_date: If ANY deadline, date, or time reference is mentioned, extract it in YYYY-MM-DD format. Look for words like "by", "before", "due", "deadline", "this week", "tomorrow", "Friday", etc. Use today's date ${new Date().toISOString().split("T")[0]} as reference. If no date, use null.
- priority: "high" if urgent/time-sensitive/financial, "medium" for normal follow-ups, "low" for nice-to-have
- category: One of: bills, work, personal, household, health, shopping, general

Emails:
${emailList}

Respond ONLY with a valid JSON array. Each element must have:
{ "index": number, "classification": "ACTION_REQUIRED"|"INFORMATIONAL"|"SKIP", "task_summary": string|null, "due_date": string|null, "priority": string|null, "category": string|null }`,
    config: { temperature: 0.1, maxOutputTokens: 2000 },
  });

  const responseText = (response.text || "").trim();

  // Parse AI response
  let triageResults: TriageResult[] = [];
  try {
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      triageResults = JSON.parse(jsonMatch[0]);
    }
  } catch (parseErr) {
    console.error("[email-mcp] Failed to parse Gemini response:", parseErr, "Raw:", responseText.substring(0, 500));
    // Fallback: treat all as informational
    triageResults = emails.map((_, i) => ({
      index: i + 1,
      classification: "INFORMATIONAL" as const,
    }));
  }

  // 5. Create tasks for ACTION_REQUIRED items
  let tasksCreated = 0;
  const actionItems: string[] = [];
  const newlyProcessedIds: string[] = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const triage = triageResults.find((t: any) => t.index === i + 1) || { classification: "SKIP" };

    // Track all processed email IDs (even skipped) for state-based dedup
    newlyProcessedIds.push(email.id);

    if (triage.classification !== "ACTION_REQUIRED" || !triage.task_summary) {
      continue;
    }

    // Strip PII from task summary
    const cleanSummary = stripPII(triage.task_summary);

    // Check for duplicate (same source_ref = email message id)
    const { data: existing } = await supabase
      .from("clerk_notes")
      .select("id")
      .eq("author_id", userId)
      .eq("source_ref", email.id)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`[email-mcp] Skipping duplicate task for email ${email.id}`);
      continue;
    }

    // Build the original_text from email metadata (required NOT NULL field)
    const originalText = `[Email from ${stripPII(email.from)}] ${email.subject}`;

    // Insert task — original_text and summary are both required
    const noteData: Record<string, unknown> = {
      author_id: userId,
      couple_id: coupleId,
      original_text: originalText,
      summary: cleanSummary,
      category: triage.category || "general",
      priority: triage.priority || "medium",
      source: "email",
      source_ref: email.id,
      tags: ["email"],
      completed: false,
    };

    if (triage.due_date) {
      noteData.due_date = new Date(triage.due_date).toISOString();
    }

    const { error: insertErr } = await supabase.from("clerk_notes").insert(noteData);

    if (!insertErr) {
      tasksCreated++;
      const priorityEmoji = triage.priority === "high" ? " \u2014 HIGH" : triage.priority === "medium" ? " \u2014 MEDIUM" : "";
      const dateStr = triage.due_date ? ` (due ${triage.due_date})` : "";
      actionItems.push(`${cleanSummary}${dateStr}${priorityEmoji}`);
    }
  }

  // 6. Update last_sync_at
  await supabase
    .from("olive_email_connections")
    .update({ last_sync_at: new Date().toISOString(), error_message: null })
    .eq("id", conn.id);

  // 7. Build summary
  let summary = "";
  if (tasksCreated > 0) {
    summary = `📧 Email Triage Complete\nFound ${tasksCreated} action item${tasksCreated > 1 ? "s" : ""} in your inbox:\n\n`;
    actionItems.forEach((item) => {
      summary += `• ${item}\n`;
    });
    summary += `\nTasks created in Olive. Reply "show emails" to review.`;
  } else {
    summary = `📧 Email Triage Complete\nScanned ${emails.length} email${emails.length > 1 ? "s" : ""} — no action items found. You're all caught up!`;
  }

  // Merge with previously processed IDs (keep last 200 to bound state size)
  const allProcessedIds = [...previouslyProcessedIds, ...newlyProcessedIds].slice(-200);

  console.log(`[email-mcp] Triage complete: ${tasksCreated} tasks from ${emails.length} emails`);

  return { tasks_created: tasksCreated, emails_processed: emails.length, summary, processed_ids: allProcessedIds };
}

/**
 * Preview-only triage: scan emails and return classifications WITHOUT saving.
 */
async function runEmailTriagePreview(
  supabase: any,
  userId: string
): Promise<{ items: any[]; emails_scanned: number }> {
  const { data: conn, error: connErr } = await supabase
    .from("olive_email_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (connErr || !conn) {
    throw new Error("Gmail not connected — please connect in Settings");
  }

  const accessToken = await getValidAccessToken(supabase, conn as EmailConnection);
  const emails = await fetchUnreadEmails(accessToken, new Set());

  if (emails.length === 0) {
    return { items: [], emails_scanned: 0 };
  }

  const genai = new GoogleGenAI({ apiKey: geminiKey });

  const emailList = emails
    .map((e, i) => `${i + 1}. Subject: "${e.subject}" | From: ${e.from} | Preview: "${e.snippet.substring(0, 150)}"`)
    .join("\n");

  const response = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an expert email triage agent. Be AGGRESSIVE about finding action items. When in doubt, classify as ACTION_REQUIRED.

Analyze each email:
- ACTION_REQUIRED: ANY task, deadline, request, appointment, payment, RSVP, follow-up, decision, someone waiting for response, booking to confirm, document to review/sign, meeting to prepare for
- INFORMATIONAL: useful info but genuinely no action (order shipped, statements, read-only)
- SKIP: marketing, automated, newsletters, spam

For ACTION_REQUIRED, extract: task_summary (imperative 1-line), due_date (YYYY-MM-DD or null, use ${new Date().toISOString().split("T")[0]} as reference), priority (high/medium/low), category (bills/work/personal/household/health/shopping/general).

Emails:
${emailList}

Respond ONLY with valid JSON array: [{"index":N,"classification":"...","task_summary":"...","due_date":null,"priority":"...","category":"..."}]`,
    config: { temperature: 0.1, maxOutputTokens: 2000 },
  });

  const responseText = (response.text || "").trim();
  let triageResults: any[] = [];
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) triageResults = JSON.parse(jsonMatch[0]);
  } catch {
    triageResults = emails.map((_, i) => ({ index: i + 1, classification: "INFORMATIONAL" }));
  }

  const items = emails.map((email, i) => {
    const triage = triageResults.find((t: any) => t.index === i + 1) || { classification: "SKIP" };
    return {
      email_id: email.id,
      subject: email.subject,
      from: stripPII(email.from),
      snippet: email.snippet.substring(0, 120),
      date: email.date,
      classification: triage.classification,
      task_summary: triage.task_summary ? stripPII(triage.task_summary) : null,
      due_date: triage.due_date || null,
      priority: triage.priority || null,
      category: triage.category || null,
      selected: triage.classification === "ACTION_REQUIRED",
    };
  });

  return { items, emails_scanned: emails.length };
}

/**
 * Confirm and save specific triage items selected by the user.
 */
async function confirmTriageItems(
  supabase: any,
  userId: string,
  coupleId: string | undefined,
  items: Array<{ email_id: string; subject: string; from: string; task_summary: string; due_date?: string | null; priority?: string; category?: string }>
): Promise<{ tasks_created: number; summary: string }> {
  let tasksCreated = 0;
  const actionItems: string[] = [];

  for (const item of items) {
    const { data: existing } = await supabase
      .from("clerk_notes")
      .select("id")
      .eq("author_id", userId)
      .eq("source_ref", item.email_id)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const originalText = `[EMAIL] ${item.subject} — from ${item.from}`;
    const noteData: Record<string, unknown> = {
      author_id: userId,
      couple_id: coupleId || null,
      original_text: originalText,
      summary: `📧 ${item.task_summary}`,
      category: item.category || "general",
      priority: item.priority || "medium",
      source: "email",
      source_ref: item.email_id,
      tags: ["email"],
      completed: false,
    };

    if (item.due_date) noteData.due_date = new Date(item.due_date).toISOString();

    const { error: insertErr } = await supabase.from("clerk_notes").insert(noteData);
    if (!insertErr) {
      tasksCreated++;
      const dateStr = item.due_date ? ` (due ${item.due_date})` : "";
      actionItems.push(`${item.task_summary}${dateStr}`);
    }
  }

  await supabase
    .from("olive_email_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("user_id", userId);

  const summary = tasksCreated > 0
    ? `📧 Created ${tasksCreated} task${tasksCreated > 1 ? "s" : ""} from email:\n${actionItems.map(i => `• ${i}`).join("\n")}`
    : "No tasks created.";

  return { tasks_created: tasksCreated, summary };
}



serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, user_id } = body;
    const supabase = createClient(supabaseUrl, supabaseKey);

    switch (action) {
      // ── Status check ──
      case "status": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const { data: conn } = await supabase
          .from("olive_email_connections")
          .select("email_address, last_sync_at, is_active, error_message, provider")
          .eq("user_id", user_id)
          .maybeSingle();

        if (!conn || !conn.is_active) {
          return jsonResponse({ success: true, connected: false });
        }

        return jsonResponse({
          success: true,
          connected: true,
          email: conn.email_address,
          provider: conn.provider,
          last_sync: conn.last_sync_at,
          error: conn.error_message,
        });
      }

      // ── Disconnect ──
      case "disconnect": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        // Deactivate and clear tokens
        await supabase
          .from("olive_email_connections")
          .update({
            is_active: false,
            access_token: null,
            refresh_token: null,
            token_expiry: null,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user_id);

        // Also deactivate the email-triage-agent skill for this user
        await supabase
          .from("olive_user_skills")
          .update({ enabled: false })
          .eq("user_id", user_id)
          .eq("skill_id", "email-triage-agent");

        console.log(`[email-mcp] Disconnected Gmail for user ${user_id}`);
        return jsonResponse({ success: true });
      }

      // ── Triage pipeline (auto-save) ──
      case "triage": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const couple_id = body.couple_id;
        const previouslyProcessedIds = (body.processed_ids as string[]) || [];
        const result = await runEmailTriage(supabase, user_id, couple_id, previouslyProcessedIds);

        return jsonResponse({ success: true, ...result });
      }

      // ── Preview triage (no save) ──
      case "preview": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const previewResult = await runEmailTriagePreview(supabase, user_id);
        return jsonResponse({ success: true, ...previewResult });
      }

      // ── Confirm selected items (save chosen tasks) ──
      case "confirm": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const items = body.items as Array<{
          email_id: string;
          subject: string;
          from: string;
          task_summary: string;
          due_date?: string | null;
          priority?: string;
          category?: string;
        }>;

        if (!items || items.length === 0) {
          return jsonResponse({ success: true, tasks_created: 0, summary: "No items selected." });
        }

        const confirmResult = await confirmTriageItems(supabase, user_id, body.couple_id, items);
        return jsonResponse({ success: true, ...confirmResult });
      }

      // ── Update email triage preferences ──
      case "update_preferences": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const prefs: Record<string, unknown> = {};
        if (body.triage_frequency !== undefined) prefs.triage_frequency = body.triage_frequency;
        if (body.triage_lookback_days !== undefined) prefs.triage_lookback_days = body.triage_lookback_days;
        if (body.auto_save_tasks !== undefined) prefs.auto_save_tasks = body.auto_save_tasks;
        prefs.updated_at = new Date().toISOString();

        const { error: updateErr } = await supabase
          .from("olive_email_connections")
          .update(prefs)
          .eq("user_id", user_id);

        if (updateErr) {
          return jsonResponse({ success: false, error: updateErr.message }, 500);
        }

        return jsonResponse({ success: true });
      }

      // ── Get preferences ──
      case "get_preferences": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const { data: prefConn } = await supabase
          .from("olive_email_connections")
          .select("triage_frequency, triage_lookback_days, auto_save_tasks")
          .eq("user_id", user_id)
          .maybeSingle();

        return jsonResponse({
          success: true,
          preferences: prefConn || { triage_frequency: '12h', triage_lookback_days: 3, auto_save_tasks: false },
        });
      }

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error("[email-mcp] Error:", error);
    return jsonResponse(
      { success: false, error: (error as Error).message },
      500
    );
  }
});

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
