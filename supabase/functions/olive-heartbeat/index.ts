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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  | 'pattern_suggestion';

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
  payload?: Record<string, any>;
}

/**
 * Call the WhatsApp gateway to send a message
 */
async function sendWhatsAppMessage(
  supabase: any,
  userId: string,
  messageType: string,
  content: string,
  priority: string = 'normal'
): Promise<boolean> {
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

    return response.data?.success === true;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
  }
}

/**
 * Call the AI service for generating content
 */
async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    throw new Error(`AI call failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Generate a morning briefing for a user
 */
async function generateMorningBriefing(supabase: any, userId: string): Promise<string> {
  // Get user's profile for personalization
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  // Get user's couple_id
  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  // Get today's tasks
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

  // Get overdue tasks
  const { data: overdueTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority, due_date')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .lt('due_date', today.toISOString())
    .order('due_date', { ascending: true })
    .limit(5);

  // Get urgent tasks
  const { data: urgentTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .eq('priority', 'high')
    .limit(5);

  // Get user's memory context for personalization
  let memoryContext = '';
  try {
    const { data: memoryData } = await supabase.functions.invoke('olive-memory', {
      body: { action: 'get_context', user_id: userId },
    });
    if (memoryData?.context?.patterns) {
      memoryContext = memoryData.context.patterns
        .filter((p: any) => p.confidence > 0.6)
        .map((p: any) => `- ${p.type}: ${JSON.stringify(p.data)}`)
        .join('\n');
    }
  } catch (e) {
    console.log('Could not fetch memory context:', e);
  }

  // Build the briefing
  let briefing = `☀️ Good morning, ${userName}!\n\n`;

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

  briefing += `💬 Reply with your plan for the day or "what's urgent" to see more.`;

  return briefing;
}

/**
 * Generate an evening review for a user
 */
async function generateEveningReview(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  // Get user's couple_id
  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  // Get tasks completed today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: completedToday } = await supabase
    .from('clerk_notes')
    .select('id, summary')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', true)
    .gte('updated_at', today.toISOString())
    .limit(10);

  // Get tasks still pending from today
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

  // Get tomorrow's tasks
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

  // Build the review
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

  if (completedToday && completedToday.length >= 3) {
    review += `🎉 Great job today! You're doing awesome.`;
  } else {
    review += `💪 Tomorrow is a new day. Rest well!`;
  }

  return review;
}

/**
 * Generate a weekly summary for a user
 */
async function generateWeeklySummary(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('clerk_profiles')
    .select('display_name')
    .eq('id', userId)
    .single();

  const userName = profile?.display_name?.split(' ')[0] || 'there';

  // Get user's couple_id
  const { data: coupleMember } = await supabase
    .from('clerk_couple_members')
    .select('couple_id')
    .eq('user_id', userId)
    .single();

  const coupleId = coupleMember?.couple_id;

  // Calculate week boundaries
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  // Get completed tasks this week
  const { data: completedThisWeek } = await supabase
    .from('clerk_notes')
    .select('id, summary, category')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', true)
    .gte('updated_at', weekStart.toISOString());

  // Get tasks created this week
  const { data: createdThisWeek } = await supabase
    .from('clerk_notes')
    .select('id')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .gte('created_at', weekStart.toISOString());

  // Get pending tasks
  const { data: pendingTasks } = await supabase
    .from('clerk_notes')
    .select('id, summary, priority')
    .or(`author_id.eq.${userId}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
    .eq('completed', false)
    .order('priority', { ascending: false })
    .limit(10);

  // Calculate stats
  const completedCount = completedThisWeek?.length || 0;
  const createdCount = createdThisWeek?.length || 0;
  const pendingCount = pendingTasks?.length || 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  completedThisWeek?.forEach((task: any) => {
    const cat = task.category || 'general';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  });

  // Build summary
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

  // Productivity message
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

/**
 * Check and send task reminders
 */
async function checkTaskReminders(supabase: any): Promise<number> {
  // Get tasks with reminders due in the next 15 minutes
  const now = new Date();
  const fifteenMinutesLater = new Date(now.getTime() + 15 * 60 * 1000);

  const { data: dueReminders, error } = await supabase
    .from('clerk_notes')
    .select('id, summary, author_id, reminder_time, due_date, auto_reminders_sent')
    .eq('completed', false)
    .gte('reminder_time', now.toISOString())
    .lte('reminder_time', fifteenMinutesLater.toISOString())
    .limit(50);

  if (error || !dueReminders) {
    console.error('Error fetching reminders:', error);
    return 0;
  }

  let sentCount = 0;

  for (const task of dueReminders) {
    // Skip if already reminded for this specific reminder_time
    const reminderKey = `heartbeat_${task.reminder_time}`;
    const alreadySent = (task.auto_reminders_sent || []).includes(reminderKey);
    if (alreadySent) continue;

    const dueInfo = task.due_date
      ? `Due: ${new Date(task.due_date).toLocaleDateString()}`
      : '';

    const content = `⏰ Reminder: ${task.summary}${dueInfo ? `\n📅 ${dueInfo}` : ''}\n\nReply "done" to complete or "snooze 1h" to remind later.`;

    const sent = await sendWhatsAppMessage(
      supabase,
      task.author_id,
      'reminder',
      content,
      'normal'
    );

    if (sent) {
      // Mark reminder as sent using auto_reminders_sent array
      const updatedSent = [...(task.auto_reminders_sent || []), reminderKey];
      await supabase
        .from('clerk_notes')
        .update({ auto_reminders_sent: updatedSent, last_reminded_at: new Date().toISOString() })
        .eq('id', task.id);

      // Log to heartbeat
      const { error: logErr } = await supabase.from('olive_heartbeat_log').insert({
        user_id: task.author_id,
        job_type: 'task_reminder',
        status: 'sent',
        message_preview: task.summary.substring(0, 100),
        channel: 'whatsapp',
      });
      if (logErr) console.error('[Heartbeat] Failed to log task_reminder:', logErr.message);

      sentCount++;
    }
  }

  return sentCount;
}

/**
 * Check and send overdue nudges
 */
async function checkOverdueNudges(supabase: any): Promise<number> {
  // Get users with overdue tasks who haven't been nudged recently
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Get users with proactive enabled and overdue tasks
  const { data: usersWithOverdue } = await supabase
    .from('olive_user_preferences')
    .select('user_id')
    .eq('proactive_enabled', true)
    .eq('overdue_nudge_enabled', true);

  if (!usersWithOverdue || usersWithOverdue.length === 0) {
    return 0;
  }

  let nudgeCount = 0;

  for (const { user_id } of usersWithOverdue) {
    // Check if already nudged today
    const { data: recentNudge } = await supabase
      .from('olive_heartbeat_log')
      .select('id')
      .eq('user_id', user_id)
      .eq('job_type', 'overdue_nudge')
      .gte('created_at', oneDayAgo.toISOString())
      .limit(1);

    if (recentNudge && recentNudge.length > 0) {
      continue; // Already nudged today
    }

    // Get overdue tasks count
    const { data: coupleMember } = await supabase
      .from('clerk_couple_members')
      .select('couple_id')
      .eq('user_id', user_id)
      .single();

    const coupleId = coupleMember?.couple_id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: overdueTasks, error } = await supabase
      .from('clerk_notes')
      .select('id, summary')
      .or(`author_id.eq.${user_id}${coupleId ? `,couple_id.eq.${coupleId}` : ''}`)
      .eq('completed', false)
      .lt('due_date', today.toISOString())
      .limit(5);

    if (error || !overdueTasks || overdueTasks.length === 0) {
      continue;
    }

    // Send nudge
    let content = `📋 Quick check-in!\n\nYou have ${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}:\n`;
    overdueTasks.slice(0, 3).forEach((task: any) => {
      content += `• ${task.summary}\n`;
    });
    if (overdueTasks.length > 3) {
      content += `...and ${overdueTasks.length - 3} more\n`;
    }
    content += `\nReply "show overdue" to see all or just send updates!`;

    const sent = await sendWhatsAppMessage(
      supabase,
      user_id,
      'proactive_nudge',
      content,
      'low'
    );

    if (sent) {
      const { error: logErr } = await supabase.from('olive_heartbeat_log').insert({
        user_id,
        job_type: 'overdue_nudge',
        status: 'sent',
        message_preview: `${overdueTasks.length} overdue tasks`,
        channel: 'whatsapp',
      });
      if (logErr) console.error('[Heartbeat] Failed to log overdue_nudge:', logErr.message);

      nudgeCount++;
    }
  }

  return nudgeCount;
}

/**
 * Process scheduled heartbeat jobs
 */
async function processHeartbeatJobs(supabase: any): Promise<{ processed: number; failed: number }> {
  const now = new Date();

  // Get pending jobs scheduled for now or earlier
  const { data: pendingJobs, error } = await supabase
    .from('olive_heartbeat_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50);

  if (error || !pendingJobs) {
    console.error('Error fetching heartbeat jobs:', error);
    return { processed: 0, failed: 1 };
  }

  let processed = 0;
  let failed = 0;

  for (const job of pendingJobs) {
    // Mark as processing
    await supabase
      .from('olive_heartbeat_jobs')
      .update({ status: 'processing' })
      .eq('id', job.id);

    try {
      let content = '';
      let messageType = job.job_type;

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

        default:
          content = job.payload?.content || 'No content provided';
      }

      if (content) {
        const sent = await sendWhatsAppMessage(
          supabase,
          job.user_id,
          messageType,
          content,
          job.payload?.priority || 'normal'
        );

        if (sent) {
          await supabase
            .from('olive_heartbeat_jobs')
            .update({ status: 'completed', completed_at: now.toISOString() })
            .eq('id', job.id);

          const { error: logErr } = await supabase.from('olive_heartbeat_log').insert({
            user_id: job.user_id,
            job_type: job.job_type,
            status: 'sent',
            message_preview: content.substring(0, 200),
            channel: 'whatsapp',
          });
          if (logErr) console.error('[Heartbeat] Failed to log job:', logErr.message);

          processed++;
        } else {
          throw new Error('Failed to send message');
        }
      }
    } catch (err) {
      console.error('Job processing error:', err);

      await supabase
        .from('olive_heartbeat_jobs')
        .update({ status: 'failed', error: String(err) })
        .eq('id', job.id);

      const { error: logErr2 } = await supabase.from('olive_heartbeat_log').insert({
        user_id: job.user_id,
        job_type: job.job_type,
        status: 'failed',
        channel: 'whatsapp',
      });
      if (logErr2) console.error('[Heartbeat] Failed to log error:', logErr2.message);

      failed++;
    }
  }

  return { processed, failed };
}

/**
 * Schedule recurring jobs for users based on their preferences
 */
async function scheduleRecurringJobs(supabase: any): Promise<number> {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Get users with proactive features enabled
  const { data: preferences, error } = await supabase
    .from('olive_user_preferences')
    .select('*')
    .eq('proactive_enabled', true);

  if (error || !preferences) {
    return 0;
  }

  let scheduled = 0;

  for (const pref of preferences) {
    // Morning briefing
    if (pref.morning_briefing_enabled) {
      const [briefingHour, briefingMinute] = pref.morning_briefing_time.split(':').map(Number);

      // Check if it's time (within 15 minute window)
      if (
        currentHour === briefingHour &&
        currentMinute >= briefingMinute &&
        currentMinute < briefingMinute + 15
      ) {
        // Check if already scheduled/sent today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: existing } = await supabase
          .from('olive_heartbeat_log')
          .select('id')
          .eq('user_id', pref.user_id)
          .eq('job_type', 'morning_briefing')
          .gte('created_at', today.toISOString())
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('olive_heartbeat_jobs').insert({
            user_id: pref.user_id,
            job_type: 'morning_briefing',
            scheduled_for: now.toISOString(),
            status: 'pending',
          });
          scheduled++;
        }
      }
    }

    // Evening review
    if (pref.evening_review_enabled) {
      const [reviewHour, reviewMinute] = pref.evening_review_time.split(':').map(Number);

      if (
        currentHour === reviewHour &&
        currentMinute >= reviewMinute &&
        currentMinute < reviewMinute + 15
      ) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: existing } = await supabase
          .from('olive_heartbeat_log')
          .select('id')
          .eq('user_id', pref.user_id)
          .eq('job_type', 'evening_review')
          .gte('created_at', today.toISOString())
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('olive_heartbeat_jobs').insert({
            user_id: pref.user_id,
            job_type: 'evening_review',
            scheduled_for: now.toISOString(),
            status: 'pending',
          });
          scheduled++;
        }
      }
    }

    // Weekly summary (check day of week)
    if (pref.weekly_summary_enabled && now.getDay() === pref.weekly_summary_day) {
      const [summaryHour, summaryMinute] = pref.weekly_summary_time.split(':').map(Number);

      if (
        currentHour === summaryHour &&
        currentMinute >= summaryMinute &&
        currentMinute < summaryMinute + 15
      ) {
        // Check if already sent this week
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const { data: existing } = await supabase
          .from('olive_heartbeat_log')
          .select('id')
          .eq('user_id', pref.user_id)
          .eq('job_type', 'weekly_summary')
          .gte('created_at', weekStart.toISOString())
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('olive_heartbeat_jobs').insert({
            user_id: pref.user_id,
            job_type: 'weekly_summary',
            scheduled_for: now.toISOString(),
            status: 'pending',
          });
          scheduled++;
        }
      }
    }
  }

  return scheduled;
}

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
        // Main heartbeat tick - runs every 15 minutes via pg_cron
        console.log('[Heartbeat] Tick started');

        // 1. Schedule recurring jobs based on user preferences
        const scheduled = await scheduleRecurringJobs(supabase);
        console.log(`[Heartbeat] Scheduled ${scheduled} recurring jobs`);

        // 2. Process pending heartbeat jobs
        const jobResult = await processHeartbeatJobs(supabase);
        console.log(`[Heartbeat] Processed ${jobResult.processed} jobs, ${jobResult.failed} failed`);

        // 3. Check and send task reminders
        const reminders = await checkTaskReminders(supabase);
        console.log(`[Heartbeat] Sent ${reminders} task reminders`);

        // 4. Check and send overdue nudges (once per day per user)
        const nudges = await checkOverdueNudges(supabase);
        console.log(`[Heartbeat] Sent ${nudges} overdue nudges`);

        // 5. Process outbound message queue
        const queueResponse = await supabase.functions.invoke('whatsapp-gateway', {
          body: { action: 'process_queue' },
        });
        const queueResult = queueResponse.data || { processed: 0, errors: 0 };
        console.log(`[Heartbeat] Processed ${queueResult.processed} queued messages`);

        return new Response(
          JSON.stringify({
            success: true,
            tick_results: {
              scheduled_jobs: scheduled,
              processed_jobs: jobResult.processed,
              failed_jobs: jobResult.failed,
              reminders_sent: reminders,
              nudges_sent: nudges,
              queue_processed: queueResult.processed,
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
        return new Response(
          JSON.stringify({ success: true, briefing }),
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
        // Test action: look up user by phone number, generate briefing, and send it
        const phoneNumber = body.payload?.phone_number;
        if (!phoneNumber) {
          return new Response(
            JSON.stringify({ success: false, error: 'payload.phone_number required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Normalize phone number for lookup
        const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
        console.log('[Heartbeat] Test briefing — looking up phone:', cleanPhone);

        // Find user by phone number
        const { data: profiles, error: profileErr } = await supabase
          .from('clerk_profiles')
          .select('id, display_name, phone_number')
          .eq('phone_number', cleanPhone)
          .limit(1);

        if (profileErr || !profiles || profiles.length === 0) {
          console.error('[Heartbeat] Profile lookup failed:', profileErr);
          return new Response(
            JSON.stringify({ success: false, error: 'User not found for phone: ' + cleanPhone, details: profileErr }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const testUserId = profiles[0].id;
        const testUserName = profiles[0].display_name;
        console.log('[Heartbeat] Found user:', testUserId, testUserName);

        // Generate briefing
        const testBriefing = await generateMorningBriefing(supabase, testUserId);
        console.log('[Heartbeat] Generated briefing:', testBriefing.substring(0, 100));

        // Send via WhatsApp gateway
        const sent = await sendWhatsAppMessage(
          supabase,
          testUserId,
          'morning_briefing',
          testBriefing,
          'high' // high priority to bypass quiet hours for testing
        );

        // Log it
        const { error: logErr } = await supabase.from('olive_heartbeat_log').insert({
          user_id: testUserId,
          job_type: 'morning_briefing',
          status: sent ? 'sent' : 'failed',
          message_preview: testBriefing.substring(0, 200),
          channel: 'whatsapp',
        });
        if (logErr) console.error('[Heartbeat] Failed to log test_briefing:', logErr.message);

        return new Response(
          JSON.stringify({
            success: sent,
            user_id: testUserId,
            user_name: testUserName,
            briefing_preview: testBriefing.substring(0, 300),
            message: sent ? 'Briefing sent successfully!' : 'Failed to send briefing',
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
    console.error('Heartbeat error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
