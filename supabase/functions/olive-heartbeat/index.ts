/**
 * Olive Heartbeat Engine
 *
 * Proactive intelligence system that runs scheduled jobs:
 * - Morning briefings
 * - Evening reviews
 * - Weekly summaries
 * - Task reminders
 * - Overdue nudges
 * - Pattern-based suggestions
 *
 * Designed to be called by pg_cron every 15 minutes.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { dedupeReminders } from "../_shared/reminder-dedup.ts";
import {
  handleContradictionResolveJob,
  type ContradictionPayload,
} from "../_shared/contradiction-resolver.ts";
import { compactActiveThreads } from "../_shared/thread-compactor.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type JobType =
  | 'morning_briefing'
  | 'evening_review'
  | 'weekly_summary'
  | 'task_reminder'
  | 'overdue_nudge'
  | 'pattern_suggestion'
  | 'contradiction_resolve';

interface HeartbeatJob {
  id: string;
  user_id: string;
  job_type: JobType;
  scheduled_for: string;
  payload: Record<string, any>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface HeartbeatRequest {
  action: 'tick' | 'schedule_job' | 'get_pending' | 'generate_briefing' | 'check_reminders' | 'test_briefing';
  user_id?: string;
  job_type?: JobType;
  channel?: string;
  payload?: Record<string, any>;
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Get the current hour and minute in a user's timezone.
 * Falls back to UTC if the timezone is invalid.
 */
function getUserLocalTime(timezone: string): { hour: number; minute: number; dayOfWeek: number } {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const weekdayStr = parts.find(p => p.type === 'weekday')?.value || 'Mon';
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = dayMap[weekdayStr] ?? now.getUTCDay();
    return { hour, minute, dayOfWeek };
  } catch {
    const now = new Date();
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes(), dayOfWeek: now.getUTCDay() };
  }
}

/**
 * Check if current time (in user's timezone) is within quiet hours.
 */
function isInQuietHours(
  quietStart: string | null,
  quietEnd: string | null,
  timezone: string
): boolean {
  if (!quietStart || !quietEnd) return false;
  const { hour } = getUserLocalTime(timezone);
  const startH = parseInt(quietStart.toString().split(':')[0]);
  const endH = parseInt(quietEnd.toString().split(':')[0]);
  if (startH < endH) {
    return hour >= startH && hour < endH;
  } else {
    // Wraps midnight (e.g. 22:00 – 07:00)
    return hour >= startH || hour < endH;
  }
}

// ─── Rate limit tracking ──────────────────────────────────────────────────────

/**
 * In-memory rate limit tracker for the current tick.
 * Tracks consecutive failures and applies exponential backoff.
 */
const rateLimitState = {
  consecutiveFailures: 0,
  lastFailureAt: 0,
  backoffUntil: 0,
};

function shouldBackOff(): boolean {
  if (rateLimitState.backoffUntil <= 0) return false;
  return Date.now() < rateLimitState.backoffUntil;
}

function recordSuccess() {
  rateLimitState.consecutiveFailures = 0;
  rateLimitState.backoffUntil = 0;
}

function recordFailure(isRateLimit: boolean) {
  rateLimitState.consecutiveFailures++;
  rateLimitState.lastFailureAt = Date.now();

  if (isRateLimit) {
    // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
    const backoffMs = Math.min(2000 * Math.pow(2, rateLimitState.consecutiveFailures - 1), 30000);
    rateLimitState.backoffUntil = Date.now() + backoffMs;
    console.warn(`[Heartbeat] Rate limited — backing off for ${backoffMs}ms (failures: ${rateLimitState.consecutiveFailures})`);
  }
}

// ─── WhatsApp delivery ────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via the gateway with rate-limit backoff.
 */
async function sendWhatsAppMessage(
  supabase: any,
  userId: string,
  messageType: string,
  content: string,
  priority: string = 'normal'
): Promise<boolean> {
  // Skip if we're in a backoff window (unless high priority)
  if (priority !== 'high' && shouldBackOff()) {
    console.log(`[Heartbeat] Skipping send to ${userId} — in backoff window (${rateLimitState.consecutiveFailures} failures)`);
    return false;
  }

  // If too many consecutive failures (5+), abort remaining sends for this tick
  if (rateLimitState.consecutiveFailures >= 5) {
    console.warn(`[Heartbeat] Circuit breaker open — skipping all sends (${rateLimitState.consecutiveFailures} consecutive failures)`);
    return false;
  }

  try {
    const response = await supabase.functions.invoke('whatsapp-gateway', {
      body: {
        action: 'send',
        message: {
          user_id: userId,
          message_type: messageType,
          content,
          priority,
        },
      },
    });

    if (response.error) {
      const errMsg = response.error.message || '';
      const isRateLimit = errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('throttl');
      recordFailure(isRateLimit);
      console.error(`[Heartbeat] Gateway invoke error for ${userId}:`, errMsg);
      return false;
    }

    const data = response.data;
    const success = data?.success === true;

    if (success) {
      recordSuccess();
    } else {
      const errStr = data?.error || '';
      const isRateLimit = typeof errStr === 'string' && (errStr.includes('429') || errStr.includes('rate') || errStr.includes('throttl'));
      recordFailure(isRateLimit);
      console.error(`[Heartbeat] Gateway returned failure for ${userId}:`, errStr);
    }
    return success;
  } catch (error) {
    recordFailure(false);
    console.error(`[Heartbeat] Failed to send WhatsApp message to ${userId}:`, error);
    return false;
  }
}

// ─── Compiled knowledge helpers ──────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Extract lines from compiled patterns content that mention a specific day name.
 * Returns up to `max` matching bullet points / lines.
 */
function extractDayInsights(patternsContent: string, dayName: string, max = 2): string[] {
  const lines = patternsContent.split('\n');
  const results: string[] = [];
  const dayLower = dayName.toLowerCase();
  for (const line of lines) {
    if (results.length >= max) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;
    if (trimmed.toLowerCase().includes(dayLower)) {
      // Clean up markdown bullet prefixes
      const cleaned = trimmed.replace(/^[-*•]\s*/, '').trim();
      if (cleaned.length > 5 && cleaned.length <= 120) {
        results.push(cleaned);
      }
    }
  }
  return results;
}

/**
 * Extract the user's preferred name from a compiled profile content string.
 * Falls back to null if not found.
 */
function extractNameFromProfile(profileContent: string): string | null {
  // Try common patterns: "Name: X", "name is X", "goes by X", "preferred name: X"
  const patterns = [
    /(?:preferred\s+name|name|goes\s+by|called)\s*[:=]\s*["']?(\w+)/i,
    /(?:their|the user(?:'s)?)\s+name\s+is\s+["']?(\w+)/i,
  ];
  for (const pat of patterns) {
    const m = profileContent.match(pat);
    if (m?.[1] && m[1].length >= 2 && m[1].length <= 20) return m[1];
  }
  return null;
}

// ─── Content generators ───────────────────────────────────────────────────────

async function generateMorningBriefing(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data: todayTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority, due_date, task_owner')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .gte('due_date', today.toISOString())
    .lt('due_date', tomorrow.toISOString())
    .order('priority', { ascending: false })
    .limit(10);

  const { data: overdueTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority, due_date')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .lt('due_date', today.toISOString())
    .order('due_date', { ascending: true })
    .limit(5);

  const { data: urgentTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .eq('priority', 'high')
    .limit(5);

  // ── Fetch Oura data if connected ──
  let ouraSection = '';
  try {
    const { data: ouraConn } = await supabase
      .from('oura_connections')
      .select('access_token, token_expiry, refresh_token, id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (ouraConn) {
      let accessToken = ouraConn.access_token;
      
      // Check token expiry and refresh if needed
      if (ouraConn.token_expiry && new Date(ouraConn.token_expiry) < new Date()) {
        const clientId = Deno.env.get("OURA_CLIENT_ID");
        const clientSecret = Deno.env.get("OURA_CLIENT_SECRET");
        if (clientId && clientSecret) {
          const refreshRes = await fetch("https://api.ouraring.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId, client_secret: clientSecret,
              grant_type: "refresh_token", refresh_token: ouraConn.refresh_token,
            }),
          });
          if (refreshRes.ok) {
            const tokens = await refreshRes.json();
            accessToken = tokens.access_token;
            await supabase.from('oura_connections').update({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token || ouraConn.refresh_token,
              token_expiry: new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString(),
            }).eq('id', ouraConn.id);
          }
        }
      }

      const todayStr = today.toISOString().split('T')[0];
      const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
      const headers = { Authorization: `Bearer ${accessToken}` };

      const [sleepRes, readinessRes] = await Promise.all([
        fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${yesterdayStr}&end_date=${todayStr}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${yesterdayStr}&end_date=${todayStr}`, { headers }),
      ]);

      let sleepScore: number | null = null;
      let readinessScore: number | null = null;

      if (sleepRes.ok) {
        const sleepData = await sleepRes.json();
        const latest = sleepData?.data?.[sleepData.data.length - 1];
        sleepScore = latest?.score ?? null;
      }

      if (readinessRes.ok) {
        const readinessData = await readinessRes.json();
        const latest = readinessData?.data?.[readinessData.data.length - 1];
        readinessScore = latest?.score ?? null;
      }

      if (sleepScore !== null || readinessScore !== null) {
        ouraSection += `\n🛏️ Health check-in:\n`;
        if (sleepScore !== null) {
          const sleepEmoji = sleepScore >= 85 ? '🟢' : sleepScore >= 70 ? '🟡' : '🔴';
          ouraSection += `• Sleep: ${sleepEmoji} ${sleepScore}/100\n`;
        }
        if (readinessScore !== null) {
          const readyEmoji = readinessScore >= 85 ? '🟢' : readinessScore >= 70 ? '🟡' : '🔴';
          ouraSection += `• Readiness: ${readyEmoji} ${readinessScore}/100\n`;
        }
        
        // Personalized advice
        if (sleepScore !== null && sleepScore < 70) {
          ouraSection += `💡 Your sleep was low — consider lighter tasks today.\n`;
        } else if (readinessScore !== null && readinessScore >= 85) {
          ouraSection += `💪 You're in great shape today — tackle those big tasks!\n`;
        }
        ouraSection += '\n';
      }
    }
  } catch (ouraErr) {
    console.error('[Heartbeat] Oura data fetch error (non-blocking):', ouraErr);
  }

  let briefing = `☀️ Good morning, ${userName}!\n\n`;

  // Add Oura section right after greeting
  if (ouraSection) {
    briefing += ouraSection;
  }

  if (overdueTasks && overdueTasks.length > 0) {
    briefing += `⚠️ ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}:\n`;
    overdueTasks.slice(0, 3).forEach((task: any) => {
      briefing += `• ${task.summary}\n`;
    });
    briefing += '\n';
  }

  if (todayTasks && todayTasks.length > 0) {
    briefing += `📅 Today's tasks (${todayTasks.length}):\n`;
    todayTasks.slice(0, 5).forEach((task: any, i: number) => {
      const priority = task.priority === 'high' ? ' 🔥' : '';
      briefing += `${i + 1}. ${task.summary}${priority}\n`;
    });
    if (todayTasks.length > 5) {
      briefing += `   ...and ${todayTasks.length - 5} more\n`;
    }
    briefing += '\n';
  } else if (!overdueTasks || overdueTasks.length === 0) {
    briefing += `✨ No tasks scheduled for today!\n\n`;
  }

  if (urgentTasks && urgentTasks.length > 0 && (!todayTasks || !todayTasks.some((t: any) => t.priority === 'high'))) {
    briefing += `🔥 Urgent:\n`;
    urgentTasks.slice(0, 2).forEach((task: any) => {
      briefing += `• ${task.summary}\n`;
    });
    briefing += '\n';
  }

  // ── Fetch recent agent highlights (last 24h) ──
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAgentRuns } = await supabase
      .from('olive_agent_runs')
      .select('agent_id, result, completed_at')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', twentyFourHoursAgo)
      .order('completed_at', { ascending: false })
      .limit(10);

    if (recentAgentRuns && recentAgentRuns.length > 0) {
      // Deduplicate by agent_id (keep most recent), filter trivial
      const trivialPrefixes = [
        'no stale tasks', 'no upcoming bills', 'no bill-related', 'oura not connected',
        'no oura data', 'no tasks scheduled', 'not enough sleep', 'too soon',
        'sleep looks good', 'no upcoming dates', 'no dates in reminder', 'no messages to send',
        'no couple linked', 'couple members not found', 'gmail not connected',
        'email triage set to manual', 'could not fetch dates',
      ];
      const seen = new Set<string>();
      const highlights: string[] = [];

      for (const run of recentAgentRuns) {
        if (seen.has(run.agent_id)) continue;
        seen.add(run.agent_id);

        const msg = (run.result?.message || '').trim();
        if (!msg) continue;
        const lower = msg.toLowerCase();
        if (trivialPrefixes.some(p => lower.startsWith(p)) || lower.startsWith('too soon (')) continue;

        // Truncate to first meaningful line, max 80 chars
        const firstLine = msg.split('\n').find((l: string) => l.trim().length > 5) || msg;
        const truncated = firstLine.length > 80 ? firstLine.substring(0, 77) + '...' : firstLine;
        const agentLabel = run.agent_id
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase())
          .replace('Stale Task Strategist', 'Task Strategist')
          .replace('Smart Bill Reminder', 'Bill Reminder')
          .replace('Energy Task Suggester', 'Energy Coach')
          .replace('Sleep Optimization Coach', 'Sleep Coach')
          .replace('Birthday Gift Agent', 'Birthday Reminder')
          .replace('Weekly Couple Sync', 'Couple Sync')
          .replace('Email Triage Agent', 'Email Triage');
        highlights.push(`• ${agentLabel}: ${truncated}`);
      }

      if (highlights.length > 0) {
        briefing += `\n🤖 Agent Highlights:\n`;
        highlights.slice(0, 2).forEach(h => { briefing += `${h}\n`; });
        briefing += '\n';
      }
    }
  } catch (agentErr) {
    console.error('[Heartbeat] Agent highlights fetch error (non-blocking):', agentErr);
  }

  // ── Compiled knowledge: patterns & profile for personalized insights ──
  try {
    const [{ data: patternsFile }, { data: profileFile }] = await Promise.all([
      supabase
        .from('olive_memory_files')
        .select('content')
        .eq('user_id', userId)
        .eq('file_type', 'patterns')
        .is('file_date', null)
        .single(),
      supabase
        .from('olive_memory_files')
        .select('content')
        .eq('user_id', userId)
        .eq('file_type', 'profile')
        .is('file_date', null)
        .single(),
    ]);

    // Try to use a richer name from profile
    if (profileFile?.content) {
      const profileName = extractNameFromProfile(profileFile.content);
      if (profileName) {
        briefing = briefing.replace(
          `Good morning, ${userName}!`,
          `Good morning, ${profileName}!`
        );
      }
    }

    // Surface day-relevant pattern insights (use user's timezone)
    if (patternsFile?.content) {
      const { data: userPrefs } = await supabase
        .from('olive_user_preferences')
        .select('timezone')
        .eq('user_id', userId)
        .single();
      const userTz = userPrefs?.timezone || 'UTC';
      const { dayOfWeek: userDayOfWeek } = getUserLocalTime(userTz);
      const todayDayName = DAY_NAMES[userDayOfWeek];
      const insights = extractDayInsights(patternsFile.content, todayDayName);
      if (insights.length > 0) {
        briefing += `\n💡 Based on your patterns:\n`;
        insights.forEach(insight => { briefing += `• ${insight}\n`; });
        briefing += '\n';
      }
    }
  } catch (compiledErr) {
    console.warn('[Heartbeat] Compiled knowledge fetch error (non-blocking):', compiledErr);
  }

  briefing += `💬 Reply with your plan for the day or "what's urgent" to see more.`;

  return briefing;
}

async function generateEveningReview(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: completedToday } = await supabase
    .from('clerk_notes')
    .select('id, summary')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', true)
    .gte('updated_at', today.toISOString())
    .limit(10);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { data: stillPending } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .gte('due_date', today.toISOString())
    .lt('due_date', tomorrow.toISOString())
    .limit(5);

  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const { data: tomorrowTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .gte('due_date', tomorrow.toISOString())
    .lt('due_date', dayAfter.toISOString())
    .limit(5);

  let review = `🌙 Evening review, ${userName}!\n\n`;

  if (completedToday && completedToday.length > 0) {
    review += `✅ Completed today (${completedToday.length}):\n`;
    completedToday.slice(0, 3).forEach((task: any) => {
      review += `• ${task.summary}\n`;
    });
    if (completedToday.length > 3) {
      review += `   ...and ${completedToday.length - 3} more!\n`;
    }
    review += '\n';
  }

  if (stillPending && stillPending.length > 0) {
    review += `⏳ Still pending from today:\n`;
    stillPending.forEach((task: any) => {
      const priority = task.priority === 'high' ? ' 🔥' : '';
      review += `• ${task.summary}${priority}\n`;
    });
    review += '\n';
  }

  if (tomorrowTasks && tomorrowTasks.length > 0) {
    review += `📅 Tomorrow:\n`;
    tomorrowTasks.slice(0, 3).forEach((task: any) => {
      review += `• ${task.summary}\n`;
    });
    review += '\n';
  }

  // ── Compiled knowledge: tomorrow tip from patterns ──
  try {
    const { data: patternsFile } = await supabase
      .from('olive_memory_files')
      .select('content')
      .eq('user_id', userId)
      .eq('file_type', 'patterns')
      .is('file_date', null)
      .single();

    if (patternsFile?.content) {
      const { data: userPrefsEv } = await supabase
        .from('olive_user_preferences')
        .select('timezone')
        .eq('user_id', userId)
        .single();
      const userTzEv = userPrefsEv?.timezone || 'UTC';
      const { dayOfWeek: userDayEv } = getUserLocalTime(userTzEv);
      const tomorrowDayName = DAY_NAMES[(userDayEv + 1) % 7];
      const tomorrowInsights = extractDayInsights(patternsFile.content, tomorrowDayName, 1);
      if (tomorrowInsights.length > 0) {
        review += `\n📝 Tomorrow tip: ${tomorrowInsights[0]}\n`;
        review += '\n';
      }
    }
  } catch (compiledErr) {
    console.warn('[Heartbeat] Compiled patterns fetch error in evening review (non-blocking):', compiledErr);
  }

  if (completedToday && completedToday.length >= 3) {
    review += `🎉 Great job today! You're doing awesome.`;
  } else {
    review += `💪 Tomorrow is a new day. Rest well!`;
  }

  return review;
}

async function generateWeeklySummary(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const { data: completedThisWeek } = await supabase
    .from('clerk_notes')
    .select('id, summary, category')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', true)
    .gte('updated_at', weekStart.toISOString());

  const { data: createdThisWeek } = await supabase
    .from('clerk_notes')
    .select('id')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .gte('created_at', weekStart.toISOString());

  const { data: pendingTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .order('priority', { ascending: false })
    .limit(10);

  const completedCount = completedThisWeek?.length || 0;
  const createdCount = createdThisWeek?.length || 0;
  const pendingCount = pendingTasks?.length || 0;

  const categoryBreakdown: Record<string, number> = {};
  completedThisWeek?.forEach((task: any) => {
    const cat = task.category || 'general';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });

  let summary = `📊 Weekly Summary for ${userName}\n\n`;
  summary += `📈 This Week:\n`;
  summary += `• Completed: ${completedCount} tasks\n`;
  summary += `• Created: ${createdCount} tasks\n`;
  summary += `• Still pending: ${pendingCount} tasks\n\n`;

  if (Object.keys(categoryBreakdown).length > 0) {
    summary += `📂 By Category:\n`;
    Object.entries(categoryBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .forEach(([category, count]) => {
        summary += `• ${category}: ${count}\n`;
      });
    summary += '\n';
  }

  if (completedCount >= 10) {
    summary += `🏆 Amazing week! You completed ${completedCount} tasks!`;
  } else if (completedCount >= 5) {
    summary += `💪 Good progress! ${completedCount} tasks completed.`;
  } else if (completedCount > 0) {
    summary += `✨ ${completedCount} task${completedCount > 1 ? 's' : ''} done. Every step counts!`;
  } else {
    summary += `🌱 Fresh start next week! You've got this.`;
  }

  return summary;
}

// ─── Task reminders ───────────────────────────────────────────────────────────

/**
 * Check and send task reminders.
 * Covers BOTH explicit reminder_time AND auto due-date reminders (24h, 2h, 15min before).
 */
async function checkTaskReminders(supabase: any): Promise<number> {
  const now = new Date();
  const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);

  // ── 1. Explicit reminders (user-set reminder_time) ──
  const { data: explicitReminders, error: expErr } = await supabase
    .from('clerk_notes')
    .select('id, summary, author_id, reminder_time, due_date, auto_reminders_sent, recurrence_frequency, recurrence_interval')
    .eq('completed', false)
    .not('reminder_time', 'is', null)
    .lte('reminder_time', fifteenMinutesLater.toISOString())
    .gte('reminder_time', now.toISOString())
    .limit(100);

  if (expErr) console.error('[Heartbeat] Error fetching explicit reminders:', expErr.message);

  // ── 2. Auto due-date reminders (24h, 2h, 15min windows) ──
  // Instead of tight ±0.1h windows, use wider windows aligned with 15-min cron
  const { data: dueDateNotes, error: ddErr } = await supabase
    .from('clerk_notes')
    .select('id, summary, author_id, due_date, auto_reminders_sent')
    .eq('completed', false)
    .not('due_date', 'is', null)
    .gte('due_date', now.toISOString()) // Only future due dates
    .limit(200);

  if (ddErr) console.error('[Heartbeat] Error fetching due-date notes:', ddErr.message);

  const autoReminders: any[] = [];
  if (dueDateNotes) {
    for (const note of dueDateNotes) {
      const dueDate = new Date(note.due_date);
      const minutesUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60);
      const alreadySent = note.auto_reminders_sent || [];

      // 24h window: 23h45m to 24h15m (±15 min for cron alignment)
      if (minutesUntilDue >= 1425 && minutesUntilDue <= 1455 && !alreadySent.includes('24h')) {
        autoReminders.push({ ...note, _reminderType: '24h', _reminderMsg: 'in 24 hours' });
      }
      // 2h window: 1h45m to 2h15m
      else if (minutesUntilDue >= 105 && minutesUntilDue <= 135 && !alreadySent.includes('2h')) {
        autoReminders.push({ ...note, _reminderType: '2h', _reminderMsg: 'in 2 hours' });
      }
      // 15min window: 0 to 20min
      else if (minutesUntilDue >= 0 && minutesUntilDue <= 20 && !alreadySent.includes('15min')) {
        autoReminders.push({ ...note, _reminderType: '15min', _reminderMsg: 'in 15 minutes' });
      }
    }
  }

  const allReminders = dedupeReminders([...(explicitReminders || []), ...autoReminders]);
  console.log(`[Heartbeat] Reminders: ${explicitReminders?.length || 0} explicit, ${autoReminders.length} auto-due`);

  if (allReminders.length === 0) return 0;

  // Group by author for batched sending
  const byAuthor: Record<string, any[]> = {};
  for (const r of allReminders) {
    if (!r.author_id) continue;
    // Skip if already sent for explicit reminders
    if (r.reminder_time) {
      const key = `heartbeat_${r.reminder_time}`;
      if ((r.auto_reminders_sent || []).includes(key)) continue;
    }
    if (!byAuthor[r.author_id]) byAuthor[r.author_id] = [];
    byAuthor[r.author_id].push(r);
  }

  let sentCount = 0;

  for (const [authorId, tasks] of Object.entries(byAuthor)) {
    // Check quiet hours for this user
    const { data: prefs } = await supabase
      .from('olive_user_preferences')
      .select('quiet_hours_start, quiet_hours_end, timezone')
      .eq('user_id', authorId)
      .single();

    if (prefs && isInQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end, prefs.timezone || 'UTC')) {
      console.log(`[Heartbeat] Skipping reminders for ${authorId} — quiet hours`);
      continue;
    }

    // Build message
    let content: string;
    if (tasks.length === 1) {
      const t = tasks[0];
      if (t._reminderType) {
        content = `⏰ Reminder: "${t.summary}" is due ${t._reminderMsg}\n\nReply "done" to complete or "snooze 1h" to remind later.`;
      } else {
        content = `⏰ Here's your reminder: "${t.summary}"\n\nReply "done" to complete or "snooze 1h" to remind later.`;
      }
    } else {
      content = `⏰ You have ${tasks.length} reminders:\n\n`;
      tasks.slice(0, 8).forEach((t: any, i: number) => {
        content += `${i + 1}. ${t.summary}${t._reminderType ? ` (due ${t._reminderMsg})` : ''}\n`;
      });
      if (tasks.length > 8) content += `...and ${tasks.length - 8} more\n`;
      content += `\nReply "done 1" to complete a task or "snooze all" to remind later.`;
    }

    const sent = await sendWhatsAppMessage(supabase, authorId, 'reminder', content, 'normal');

    if (sent) {
      sentCount++;

      // Mark each task as reminded
      for (const task of tasks) {
        const updateData: any = {
          last_reminded_at: new Date().toISOString(),
        };

        if (task._reminderType) {
          // Auto due-date reminder
          updateData.auto_reminders_sent = [...(task.auto_reminders_sent || []), task._reminderType];
        } else if (task.reminder_time) {
          // Explicit reminder — mark sent and handle recurrence
          const sentKey = `heartbeat_${task.reminder_time}`;
          updateData.auto_reminders_sent = [...(task.auto_reminders_sent || []), sentKey];

          if (task.recurrence_frequency && task.recurrence_frequency !== 'none') {
            const interval = task.recurrence_interval || 1;
            const next = new Date(task.reminder_time);
            switch (task.recurrence_frequency) {
              case 'daily': next.setDate(next.getDate() + interval); break;
              case 'weekly': next.setDate(next.getDate() + 7 * interval); break;
              case 'monthly': next.setMonth(next.getMonth() + interval); break;
              case 'yearly': next.setFullYear(next.getFullYear() + interval); break;
            }
            updateData.reminder_time = next.toISOString();
          } else {
            updateData.reminder_time = null; // One-time reminder — clear it
          }
        }

        await supabase.from('clerk_notes').update(updateData).eq('id', task.id);
      }

      // Log
      await supabase.from('olive_heartbeat_log').insert({
        user_id: authorId,
        job_type: 'task_reminder',
        status: 'sent',
        message_preview: content.substring(0, 200),
        channel: 'whatsapp',
      }).then(({ error: logErr }: any) => {
        if (logErr) console.error('[Heartbeat] Log error:', logErr.message);
      });
    }
  }

  return sentCount;
}

// ─── Overdue nudges ───────────────────────────────────────────────────────────

async function checkOverdueNudges(supabase: any): Promise<number> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: usersWithOverdue } = await supabase
    .from('olive_user_preferences')
    .select('user_id, quiet_hours_start, quiet_hours_end, timezone')
    .eq('proactive_enabled', true)
    .eq('overdue_nudge_enabled', true);

  if (!usersWithOverdue || usersWithOverdue.length === 0) return 0;

  let nudgeCount = 0;

  for (const pref of usersWithOverdue) {
    // Check quiet hours
    if (isInQuietHours(pref.quiet_hours_start, pref.quiet_hours_end, pref.timezone || 'UTC')) {
      continue;
    }

    // Check if already nudged in last 24h
    const { data: recentNudge } = await supabase
      .from('olive_heartbeat_log')
      .select('id')
      .eq('user_id', pref.user_id)
      .eq('job_type', 'overdue_nudge')
      .gte('created_at', oneDayAgo.toISOString())
      .limit(1);

    if (recentNudge && recentNudge.length > 0) continue;

    const { data: coupleMember } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', pref.user_id)
      .single();

    const coupleId = coupleMember?.couple_id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: overdueTasks, error } = await supabase
      .from('clerk_notes')
      .select('id, summary')
      .or(`author_id.eq.${pref.user_id}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
      .eq('completed', false)
      .lt('due_date', today.toISOString())
      .limit(5);

    if (error || !overdueTasks || overdueTasks.length === 0) continue;

    let content = `📋 Quick check-in!\n\nYou have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}:\n`;
    overdueTasks.slice(0, 3).forEach((task: any) => {
      content += `• ${task.summary}\n`;
    });
    if (overdueTasks.length > 3) {
      content += `...and ${overdueTasks.length - 3} more\n`;
    }
    content += `\nReply "show overdue" to see all or just send updates!`;

    const sent = await sendWhatsAppMessage(supabase, pref.user_id, 'proactive_nudge', content, 'low');

    if (sent) {
      await supabase.from('olive_heartbeat_log').insert({
        user_id: pref.user_id,
        job_type: 'overdue_nudge',
        status: 'sent',
        message_preview: `${overdueTasks.length} overdue tasks`,
        channel: 'whatsapp',
      });
      nudgeCount++;
    }
  }

  return nudgeCount;
}

// ─── Job processing ───────────────────────────────────────────────────────────

async function processHeartbeatJobs(supabase: any): Promise<{ processed: number; failed: number }> {
  const now = new Date();

  const { data: pendingJobs, error } = await supabase
    .from('olive_heartbeat_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (error || !pendingJobs) {
    console.error('[Heartbeat] Error fetching jobs:', error);
    return { processed: 0, failed: error ? 1 : 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const job of pendingJobs) {
    await supabase.from('olive_heartbeat_jobs').update({ status: 'processing' }).eq('id', job.id);

    try {
      let content = '';

      switch (job.job_type) {
        case 'morning_briefing':
          content = await generateMorningBriefing(supabase, job.user_id);
          break;
        case 'evening_review':
          content = await generateEveningReview(supabase, job.user_id);
          break;
        case 'weekly_summary':
          content = await generateWeeklySummary(supabase, job.user_id);
          break;
        case 'contradiction_resolve': {
          // Ask-user flow for memory contradictions (Phase 2).
          // We diverge from the generic send path because we need to insert
          // an `olive_pending_questions` row BEFORE the send and roll it
          // back if the send fails (otherwise the user never sees the
          // question but their next message would be mis-classified as an
          // answer).
          const payload = (job.payload || {}) as ContradictionPayload;
          if (!payload.contradiction_id) {
            throw new Error('contradiction_resolve job missing contradiction_id');
          }

          const prepared = await handleContradictionResolveJob(
            supabase,
            job.user_id,
            payload,
            'whatsapp'
          );

          if (!prepared) {
            // Already resolved or no-op — mark this job done and move on.
            await supabase
              .from('olive_heartbeat_jobs')
              .update({ status: 'completed' })
              .eq('id', job.id);
            await supabase.from('olive_heartbeat_log').insert({
              user_id: job.user_id,
              job_type: job.job_type,
              status: 'skipped',
              message_preview: 'already_resolved_or_noop',
              channel: 'whatsapp',
            });
            processed++;
            continue;
          }

          const sent = await sendWhatsAppMessage(
            supabase,
            job.user_id,
            'contradiction_resolve',
            prepared.questionText,
            job.payload?.priority || 'normal'
          );

          if (sent) {
            await supabase
              .from('olive_heartbeat_jobs')
              .update({ status: 'completed' })
              .eq('id', job.id);
            await supabase.from('olive_heartbeat_log').insert({
              user_id: job.user_id,
              job_type: job.job_type,
              status: 'sent',
              message_preview: prepared.questionText.substring(0, 200),
              channel: 'whatsapp',
            });
            processed++;
          } else {
            // Roll back: cancel the pending question so the user isn't
            // trapped in an unanswerable state on their next message.
            await supabase
              .from('olive_pending_questions')
              .update({ status: 'cancelled' })
              .eq('id', prepared.pendingQuestionId);
            throw new Error('Gateway send failed for contradiction_resolve');
          }
          continue; // skip the generic send block below
        }
        default:
          content = job.payload?.content || 'No content provided';
      }

      if (content) {
        const sent = await sendWhatsAppMessage(
          supabase,
          job.user_id,
          job.job_type,
          content,
          job.payload?.priority || 'normal'
        );

        if (sent) {
          await supabase.from('olive_heartbeat_jobs').update({ status: 'completed' }).eq('id', job.id);
          await supabase.from('olive_heartbeat_log').insert({
            user_id: job.user_id,
            job_type: job.job_type,
            status: 'sent',
            message_preview: content.substring(0, 200),
            channel: 'whatsapp',
          });
          processed++;
        } else {
          throw new Error('Gateway send failed');
        }
      }
    } catch (err) {
      console.error(`[Heartbeat] Job ${job.id} failed:`, err);
      await supabase.from('olive_heartbeat_jobs').update({ status: 'failed' }).eq('id', job.id);
      await supabase.from('olive_heartbeat_log').insert({
        user_id: job.user_id,
        job_type: job.job_type,
        status: 'failed',
        channel: 'whatsapp',
      });
      failed++;
    }
  }

  return { processed, failed };
}

// ─── Recurring job scheduler (TIMEZONE-AWARE) ─────────────────────────────────

/**
 * Schedule recurring briefings, reviews, and summaries based on each user's
 * timezone and preferences.
 */
async function scheduleRecurringJobs(supabase: any): Promise<number> {
  const { data: preferences, error } = await supabase
    .from('olive_user_preferences')
    .select('*')
    .eq('proactive_enabled', true);

  if (error || !preferences) return 0;

  let scheduled = 0;

  for (const pref of preferences) {
    const tz = pref.timezone || 'UTC';
    const { hour: localHour, minute: localMinute, dayOfWeek: localDay } = getUserLocalTime(tz);

    // Check quiet hours first
    if (isInQuietHours(pref.quiet_hours_start, pref.quiet_hours_end, tz)) {
      continue;
    }

    // Helper: check if local time is within a 15-min window of target HH:MM
    const isInWindow = (targetTime: string): boolean => {
      if (!targetTime) return false;
      const [targetH, targetM] = targetTime.split(':').map(Number);
      if (isNaN(targetH) || isNaN(targetM)) return false;
      const targetMinutes = targetH * 60 + targetM;
      const currentMinutes = localHour * 60 + localMinute;
      return currentMinutes >= targetMinutes && currentMinutes < targetMinutes + 15;
    };

    // Helper: check if already sent today (in UTC terms, using created_at)
    const alreadySentToday = async (jobType: string): Promise<boolean> => {
      // Use a 20-hour lookback to prevent double-sends even across timezone boundaries
      const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
      const { data } = await supabase
        .from('olive_heartbeat_log')
        .select('id')
        .eq('user_id', pref.user_id)
        .eq('job_type', jobType)
        .gte('created_at', twentyHoursAgo.toISOString())
        .limit(1);
      return (data && data.length > 0);
    };

    // Morning briefing
    if (pref.morning_briefing_enabled && isInWindow(pref.morning_briefing_time)) {
      if (!(await alreadySentToday('morning_briefing'))) {
        const { error: insertErr } = await supabase.from('olive_heartbeat_jobs').insert({
          user_id: pref.user_id,
          job_type: 'morning_briefing',
          scheduled_for: new Date().toISOString(),
          status: 'pending',
        });
        if (!insertErr) {
          scheduled++;
          console.log(`[Heartbeat] Scheduled morning_briefing for ${pref.user_id} (local ${localHour}:${localMinute} ${tz})`);
        }
      }
    }

    // Evening review
    if (pref.evening_review_enabled && isInWindow(pref.evening_review_time)) {
      if (!(await alreadySentToday('evening_review'))) {
        const { error: insertErr } = await supabase.from('olive_heartbeat_jobs').insert({
          user_id: pref.user_id,
          job_type: 'evening_review',
          scheduled_for: new Date().toISOString(),
          status: 'pending',
        });
        if (!insertErr) {
          scheduled++;
          console.log(`[Heartbeat] Scheduled evening_review for ${pref.user_id} (local ${localHour}:${localMinute} ${tz})`);
        }
      }
    }

    // Weekly summary (check day of week in user's timezone)
    if (pref.weekly_summary_enabled && localDay === pref.weekly_summary_day && isInWindow(pref.weekly_summary_time)) {
      // Check this week (7-day lookback)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { data: existing } = await supabase
        .from('olive_heartbeat_log')
        .select('id')
        .eq('user_id', pref.user_id)
        .eq('job_type', 'weekly_summary')
        .gte('created_at', sevenDaysAgo.toISOString())
        .limit(1);

      if (!existing || existing.length === 0) {
        const { error: insertErr } = await supabase.from('olive_heartbeat_jobs').insert({
          user_id: pref.user_id,
          job_type: 'weekly_summary',
          scheduled_for: new Date().toISOString(),
          status: 'pending',
        });
        if (!insertErr) {
          scheduled++;
          console.log(`[Heartbeat] Scheduled weekly_summary for ${pref.user_id} (local day=${localDay})`);
        }
      }
    }
  }

  return scheduled;
}

// ─── Background agent scheduling ─────────────────────────────────────────────

/**
 * Check active background agents and invoke olive-agent-runner for any that are due.
 * Uses olive_skills (agent_type='background_agent') + olive_user_skills (enabled) +
 * olive_agent_runs (last run tracking) to determine which agents need to run.
 */
async function processBackgroundAgents(supabase: any): Promise<number> {
  // Fetch all background agents that at least one user has enabled
  const { data: activeAgents, error: agentErr } = await supabase
    .from('olive_user_skills')
    .select(`
      user_id,
      skill_id,
      config,
      olive_skills!inner (
        skill_id,
        schedule,
        agent_config,
        agent_type,
        requires_connection
      )
    `)
    .eq('enabled', true)
    .eq('olive_skills.agent_type', 'background_agent');

  if (agentErr || !activeAgents || activeAgents.length === 0) {
    if (agentErr) console.error('[Heartbeat] Error fetching active agents:', agentErr.message);
    return 0;
  }

  let invoked = 0;

  for (const activation of activeAgents) {
    const skill = activation.olive_skills;
    const userId = activation.user_id;
    const agentId = skill.skill_id;
    const schedule = skill.schedule;

    // Get user preferences for timezone and quiet hours
    const { data: prefs } = await supabase
      .from('olive_user_preferences')
      .select('timezone, quiet_hours_start, quiet_hours_end, proactive_enabled')
      .eq('user_id', userId)
      .single();

    const tz = prefs?.timezone || 'UTC';

    // Respect quiet hours
    if (prefs && isInQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end, tz)) {
      continue;
    }

    // Check if agent requires an external connection
    if (skill.requires_connection) {
      let connected = false;
      if (skill.requires_connection === 'oura') {
        const { data: oura } = await supabase
          .from('oura_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .limit(1);
        connected = oura && oura.length > 0;
      } else if (skill.requires_connection === 'gmail') {
        const { data: email } = await supabase
          .from('olive_email_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .limit(1);
        connected = email && email.length > 0;
      }
      if (!connected) continue;
    }

    // Determine if it's time to run based on schedule + timezone
    const { hour: localHour, minute: localMinute, dayOfWeek: localDay } = getUserLocalTime(tz);
    const isIn15MinWindow = (targetH: number, targetM: number = 0): boolean => {
      const target = targetH * 60 + targetM;
      const current = localHour * 60 + localMinute;
      return current >= target && current < target + 15;
    };

    let shouldRun = false;
    switch (schedule) {
      case 'daily_9am':
        shouldRun = isIn15MinWindow(9);
        break;
      case 'daily_10am':
        shouldRun = isIn15MinWindow(10);
        break;
      case 'daily_morning_briefing':
        // Run at 8am (slightly before morning briefing)
        shouldRun = isIn15MinWindow(8);
        break;
      case 'daily_check':
        shouldRun = isIn15MinWindow(9);
        break;
      case 'weekly_monday_9am':
        shouldRun = localDay === 1 && isIn15MinWindow(9);
        break;
      case 'weekly_sunday_6pm':
        shouldRun = localDay === 0 && isIn15MinWindow(18);
        break;
      case 'every_15min':
        shouldRun = true; // Always run on every tick
        break;
      default:
        shouldRun = false;
    }

    if (!shouldRun) continue;

    // Check if already ran recently (prevent double-runs within cooldown period)
    const cooldownHours = schedule === 'every_15min' ? 0.2 : // 12 min cooldown for frequent agents
                          schedule?.startsWith('weekly') ? 144 : // 6 day cooldown for weekly
                          20; // 20h cooldown for daily
    const cooldownTime = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

    const { data: recentRun } = await supabase
      .from('olive_agent_runs')
      .select('id')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .gte('started_at', cooldownTime.toISOString())
      .limit(1);

    if (recentRun && recentRun.length > 0) continue;

    // Invoke the agent runner
    try {
      console.log(`[Heartbeat] Invoking agent ${agentId} for user ${userId}`);
      const response = await supabase.functions.invoke('olive-agent-runner', {
        body: {
          action: 'run',
          agent_id: agentId,
          user_id: userId,
        },
      });

      if (response.error) {
        console.error(`[Heartbeat] Agent ${agentId} invoke error:`, response.error.message);
      } else {
        invoked++;
        console.log(`[Heartbeat] Agent ${agentId} invoked successfully for ${userId}`);
      }
    } catch (err) {
      console.error(`[Heartbeat] Agent ${agentId} invoke exception:`, err);
    }
  }

  return invoked;
}

// ─── Main serve handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: HeartbeatRequest = await req.json();
    const { action } = body;

    switch (action) {
      case 'tick': {
        console.log('[Heartbeat] Tick started at', new Date().toISOString());

        const scheduled = await scheduleRecurringJobs(supabase);
        console.log(`[Heartbeat] Scheduled ${scheduled} recurring jobs`);

        const jobResult = await processHeartbeatJobs(supabase);
        console.log(`[Heartbeat] Processed ${jobResult.processed} jobs, ${jobResult.failed} failed`);

        const reminders = await checkTaskReminders(supabase);
        console.log(`[Heartbeat] Sent ${reminders} task reminders`);

        const nudges = await checkOverdueNudges(supabase);
        console.log(`[Heartbeat] Sent ${nudges} overdue nudges`);

        // Process background agents
        const agentsInvoked = await processBackgroundAgents(supabase);
        console.log(`[Heartbeat] Invoked ${agentsInvoked} background agents`);

        // Weekly community detection (runs on Sundays at the heartbeat tick)
        let communitiesDetected = 0;
        try {
          const now = new Date();
          if (now.getUTCDay() === 0) {
            // Check if already ran this week
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const { data: recentCommunity } = await supabase
              .from('olive_heartbeat_log')
              .select('id')
              .eq('job_type', 'community_detection')
              .gte('created_at', sevenDaysAgo.toISOString())
              .limit(1);

            if (!recentCommunity || recentCommunity.length === 0) {
              // Get all active users with enough entities
              const { data: activeUsers } = await supabase
                .from('olive_entities')
                .select('user_id')
                .limit(500);

              if (activeUsers) {
                const uniqueUsers = [...new Set(activeUsers.map((e: any) => e.user_id))];
                for (const uid of uniqueUsers) {
                  try {
                    const { data: entityCount } = await supabase
                      .from('olive_entities')
                      .select('id', { count: 'exact', head: true })
                      .eq('user_id', uid);

                    // Only run for users with 5+ entities
                    if (entityCount && (entityCount as any).length >= 5) {
                      await supabase.functions.invoke('olive-community-detect', {
                        body: { user_id: uid },
                      });
                      communitiesDetected++;
                    }
                  } catch (cdErr) {
                    console.warn(`[Heartbeat] Community detection failed for ${uid}:`, cdErr);
                  }
                }

                await supabase.from('olive_heartbeat_log').insert({
                  user_id: 'system',
                  job_type: 'community_detection',
                  status: 'completed',
                  message_preview: `Ran for ${communitiesDetected} users`,
                  channel: 'internal',
                });
              }
            }
          }
        } catch (cdErr) {
          console.error('[Heartbeat] Community detection error (non-blocking):', cdErr);
        }
        console.log(`[Heartbeat] Community detection: ${communitiesDetected} users processed`);

        // Thread compaction (Phase 2 Task 2-B)
        // Runs BEFORE the outbound queue drain so the summaries are
        // available for any context-assembly triggered by this tick's
        // briefings / reviews. Compaction failures are non-blocking.
        let compactionResult = { scanned: 0, compacted: 0, skipped: 0, failed: 0 };
        try {
          compactionResult = await compactActiveThreads(supabase);
          console.log(
            `[Heartbeat] Compaction: scanned=${compactionResult.scanned}, ` +
            `compacted=${compactionResult.compacted}, skipped=${compactionResult.skipped}, ` +
            `failed=${compactionResult.failed}`
          );
        } catch (compactErr) {
          console.error('[Heartbeat] Compaction error (non-blocking):', compactErr);
        }

        // Process queued outbound messages
        const queueResponse = await supabase.functions.invoke('whatsapp-gateway', {
          body: { action: 'process_queue' },
        });
        const queueResult = queueResponse.data || { processed: 0, errors: 0 };
        console.log(`[Heartbeat] Queue: ${queueResult.processed} processed`);

        return new Response(
          JSON.stringify({
            success: true,
            tick_results: {
              scheduled_jobs: scheduled,
              processed_jobs: jobResult.processed,
              failed_jobs: jobResult.failed,
              reminders_sent: reminders,
              nudges_sent: nudges,
              agents_invoked: agentsInvoked,
              communities_detected: communitiesDetected,
              compaction: compactionResult,
              queue_processed: queueResult.processed,
              rate_limit_state: {
                consecutive_failures: rateLimitState.consecutiveFailures,
                backed_off: shouldBackOff(),
              },
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'generate_briefing': {
        if (!body.user_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const briefing = await generateMorningBriefing(supabase, body.user_id);
        let whatsappSent = false;

        // If channel is 'whatsapp', actually send the briefing via WhatsApp
        if (body.payload?.channel === 'whatsapp' || (body as any).channel === 'whatsapp') {
          console.log('[Heartbeat] generate_briefing: sending via WhatsApp to', body.user_id);
          whatsappSent = await sendWhatsAppMessage(
            supabase,
            body.user_id,
            'morning_briefing',
            briefing,
            'high'
          );

          // Log the attempt
          await supabase.from('olive_heartbeat_log').insert({
            user_id: body.user_id,
            job_type: 'morning_briefing',
            status: whatsappSent ? 'sent' : 'failed',
            message_preview: briefing.substring(0, 200),
            channel: 'whatsapp',
          });

          if (!whatsappSent) {
            console.error('[Heartbeat] generate_briefing: WhatsApp send FAILED for', body.user_id);
          }
        }

        return new Response(
          JSON.stringify({ success: true, briefing, whatsapp_sent: whatsappSent }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'schedule_job': {
        if (!body.user_id || !body.job_type) {
          return new Response(
            JSON.stringify({ success: false, error: 'user_id and job_type required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data, error } = await supabase
          .from('olive_heartbeat_jobs')
          .insert({
            user_id: body.user_id,
            job_type: body.job_type,
            scheduled_for: body.payload?.scheduled_for || new Date().toISOString(),
            payload: body.payload || {},
            status: 'pending',
          })
          .select('id')
          .single();

        if (error) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, job_id: data.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check_reminders': {
        const count = await checkTaskReminders(supabase);
        return new Response(
          JSON.stringify({ success: true, reminders_sent: count }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'test_briefing': {
        const phoneNumber = body.payload?.phone_number;
        if (!phoneNumber) {
          return new Response(
            JSON.stringify({ success: false, error: 'payload.phone_number required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
        console.log('[Heartbeat] Test briefing — looking up phone:', cleanPhone);

        const { data: profiles, error: profileErr } = await supabase
          .from('clerk_profiles')
          .select('id, display_name, phone_number')
          .eq('phone_number', cleanPhone)
          .limit(1);

        if (profileErr || !profiles || profiles.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'User not found for phone: ' + cleanPhone }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const testUserId = profiles[0].id;
        const testBriefing = await generateMorningBriefing(supabase, testUserId);

        const sent = await sendWhatsAppMessage(supabase, testUserId, 'morning_briefing', testBriefing, 'high');

        await supabase.from('olive_heartbeat_log').insert({
          user_id: testUserId,
          job_type: 'morning_briefing',
          status: sent ? 'sent' : 'failed',
          message_preview: testBriefing.substring(0, 200),
          channel: 'whatsapp',
        });

        return new Response(
          JSON.stringify({
            success: sent,
            user_id: testUserId,
            user_name: profiles[0].display_name,
            briefing_preview: testBriefing.substring(0, 300),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[Heartbeat] Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
