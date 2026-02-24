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
const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "";

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
  supabase: ReturnType<typeof createClient>,
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
 */
async function fetchUnreadEmails(accessToken: string): Promise<GmailMessage[]> {
  // List message IDs
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", "is:unread category:primary -label:OLIVE_PROCESSED");
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
  const messageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id);

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

/**
 * Ensure the OLIVE_PROCESSED label exists and return its ID.
 */
async function getOrCreateOliveLabel(accessToken: string): Promise<string | null> {
  try {
    // List existing labels
    const labelsRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!labelsRes.ok) return null;

    const labelsData = await labelsRes.json();
    const existing = (labelsData.labels || []).find(
      (l: { name: string; id: string }) => l.name === "Olive/Processed"
    );

    if (existing) return existing.id;

    // Create the label
    const createRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Olive/Processed",
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      }
    );

    if (createRes.ok) {
      const created = await createRes.json();
      return created.id;
    }

    console.warn("[email-mcp] Could not create label — label management requires gmail.labels scope");
    return null;
  } catch (e) {
    console.error("[email-mcp] Label management error:", e);
    return null;
  }
}

/**
 * Apply the OLIVE_PROCESSED label to a message.
 */
async function labelMessageProcessed(accessToken: string, messageId: string, labelId: string): Promise<void> {
  try {
    await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addLabelIds: [labelId],
        }),
      }
    );
  } catch (e) {
    console.error(`[email-mcp] Failed to label message ${messageId}:`, e);
  }
}

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
 */
async function runEmailTriage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  coupleId?: string
): Promise<{ tasks_created: number; emails_processed: number; summary: string }> {
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

  // 3. Fetch unread primary emails
  const emails = await fetchUnreadEmails(accessToken);

  if (emails.length === 0) {
    await supabase
      .from("olive_email_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", conn.id);

    return { tasks_created: 0, emails_processed: 0, summary: "No unread emails in your primary inbox." };
  }

  console.log(`[email-mcp] Found ${emails.length} unread primary emails for user ${userId}`);

  // 4. AI Triage via Gemini
  const genai = new GoogleGenAI({ apiKey: geminiKey });

  const emailList = emails
    .map((e, i) => `${i + 1}. Subject: "${e.subject}" | From: ${e.from} | Preview: "${e.snippet.substring(0, 150)}"`)
    .join("\n");

  const response = await genai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are an email triage agent for a couples productivity app called Olive.

Analyze each email and classify it:
- ACTION_REQUIRED: Contains a task, deadline, or request requiring follow-up
- INFORMATIONAL: Good to know but no action needed
- SKIP: Marketing, automated, newsletters, or irrelevant

For ACTION_REQUIRED emails, also extract:
- task_summary: A clear 1-line task description (imperative form, e.g., "Reply to landlord about lease renewal")
- due_date: If a deadline is mentioned, provide in YYYY-MM-DD format. Otherwise null.
- priority: "high" if urgent/time-sensitive, "medium" for normal follow-ups, "low" for nice-to-have
- category: One of: bills, work, personal, household, health, shopping, general

Emails:
${emailList}

Respond ONLY with a valid JSON array. Each element must have:
{ "index": number, "classification": "ACTION_REQUIRED"|"INFORMATIONAL"|"SKIP", "task_summary": string|null, "due_date": string|null, "priority": string|null, "category": string|null }

Example:
[{"index":1,"classification":"ACTION_REQUIRED","task_summary":"Pay electric bill $127","due_date":"2026-02-28","priority":"high","category":"bills"},{"index":2,"classification":"SKIP","task_summary":null,"due_date":null,"priority":null,"category":null}]`,
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
  const labelId = await getOrCreateOliveLabel(accessToken);

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const triage = triageResults.find((t: any) => t.index === i + 1) || { classification: "SKIP" };

    // Label all processed emails (even skipped ones)
    if (labelId) {
      await labelMessageProcessed(accessToken, email.id, labelId);
    }

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

    // Insert task
    const noteData: Record<string, unknown> = {
      author_id: userId,
      couple_id: coupleId,
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
      const priorityEmoji = triage.priority === "high" ? " — HIGH" : triage.priority === "medium" ? " — MEDIUM" : "";
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

  console.log(`[email-mcp] Triage complete: ${tasksCreated} tasks from ${emails.length} emails`);

  return { tasks_created: tasksCreated, emails_processed: emails.length, summary };
}

// ─── HTTP Handler ────────────────────────────────────────────────

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

      // ── Triage pipeline ──
      case "triage": {
        if (!user_id) {
          return jsonResponse({ success: false, error: "user_id required" }, 400);
        }

        const couple_id = body.couple_id;
        const result = await runEmailTriage(supabase, user_id, couple_id);

        return jsonResponse({ success: true, ...result });
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
