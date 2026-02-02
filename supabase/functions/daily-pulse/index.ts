/**
 * DAILY-PULSE Edge Function
 * ============================================================================
 * Feature 3: Daily Pulse - Expanded 24h Cron Job
 *
 * This function runs daily and acts as a "State Monitor" with four modules:
 * A. Wishlist Monitor - Check prices against targets
 * B. Relationship Radar - Upcoming important dates reminders
 * C. Weekend Planner - Weather-based activity suggestions (Thursdays only)
 * D. Stale Task Reaper - Flag old incomplete tasks
 *
 * Scheduled to run daily at 8:00 AM UTC via pg_cron or Supabase scheduled functions
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ModuleResult {
  processed: number;
  alerts: number;
  skipped?: number;
  errors?: string[];
}

interface PulseResults {
  wishlist: ModuleResult;
  dates: ModuleResult;
  weekend: ModuleResult;
  staleTasks: ModuleResult;
}

interface Notification {
  user_id: string;
  couple_id?: string;
  type: string;
  title: string;
  message: string;
  priority: number;
  source_type?: string;
  source_id?: string;
  action_url?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// MODULE A: WISHLIST MONITOR
// ============================================================================
// Checks wishlist items with target prices and creates alerts for price drops

async function runWishlistMonitor(supabase: SupabaseClient): Promise<ModuleResult> {
  const logId = await startModuleLog(supabase, 'daily-pulse', 'wishlist_monitor');

  try {
    // Get active wishlist items with target prices
    const { data: items, error } = await supabase
      .rpc('get_wishlist_for_price_check');

    if (error) {
      console.error('[wishlist_monitor] RPC error:', error);
      await completeModuleLog(supabase, logId, 'failed', { error: error.message });
      return { processed: 0, alerts: 0, errors: [error.message] };
    }

    if (!items || items.length === 0) {
      console.log('[wishlist_monitor] No items to check');
      await completeModuleLog(supabase, logId, 'completed', { items_checked: 0 });
      return { processed: 0, alerts: 0 };
    }

    console.log('[wishlist_monitor] Checking', items.length, 'items');

    const notifications: Notification[] = [];
    const errors: string[] = [];

    for (const item of items) {
      try {
        // NOTE: Price checking would require integrating with price APIs
        // For now, we simulate by checking if current_price <= target_price
        // In production, you'd call APIs like:
        // - Amazon Product API
        // - Walmart API
        // - Custom scraping service

        const currentPrice = item.current_price;
        const targetPrice = item.target_price;

        // Update last_checked_at
        await supabase
          .from('wishlist')
          .update({
            last_checked_at: new Date().toISOString()
          })
          .eq('id', item.id);

        // Check if price is at or below target
        if (currentPrice && targetPrice && currentPrice <= targetPrice) {
          notifications.push({
            user_id: item.user_id,
            couple_id: item.couple_id,
            type: 'price_drop',
            title: 'Price Drop Alert! 🎉',
            message: `${item.item_name} is now $${currentPrice.toFixed(2)} (your target: $${targetPrice.toFixed(2)})`,
            priority: 8,
            source_type: 'wishlist',
            source_id: item.id,
            action_url: item.item_url,
            metadata: {
              item_id: item.id,
              item_name: item.item_name,
              current_price: currentPrice,
              target_price: targetPrice,
              savings: (targetPrice - currentPrice).toFixed(2)
            }
          });
        }

      } catch (itemError: any) {
        console.error('[wishlist_monitor] Item error:', item.id, itemError);
        errors.push(`Item ${item.id}: ${itemError.message}`);
      }
    }

    // Batch insert notifications
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notifError) {
        console.error('[wishlist_monitor] Notification insert error:', notifError);
        errors.push(`Notifications: ${notifError.message}`);
      } else {
        console.log('[wishlist_monitor] Created', notifications.length, 'notifications');
      }
    }

    const result = {
      items_checked: items.length,
      alerts_created: notifications.length,
      errors: errors.length > 0 ? errors : undefined
    };

    await completeModuleLog(supabase, logId, 'completed', result);

    return {
      processed: items.length,
      alerts: notifications.length,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error: any) {
    console.error('[wishlist_monitor] Error:', error);
    await completeModuleLog(supabase, logId, 'failed', { error: error.message });
    return { processed: 0, alerts: 0, errors: [error.message] };
  }
}

// ============================================================================
// MODULE B: RELATIONSHIP RADAR
// ============================================================================
// Sends reminders for upcoming important dates (birthdays, anniversaries, etc.)

async function runRelationshipRadar(supabase: SupabaseClient): Promise<ModuleResult> {
  const logId = await startModuleLog(supabase, 'daily-pulse', 'relationship_radar');

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const notifications: Notification[] = [];

    // Reminder tiers: 14 days, 7 days, 3 days, 1 day
    const reminderTiers = [14, 7, 3, 1];

    for (const daysAhead of reminderTiers) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      const targetMonth = targetDate.getMonth() + 1;
      const targetDay = targetDate.getDate();

      // Find dates matching this reminder tier
      // Check both exact date matches and yearly recurrence (month/day match)
      const { data: dates, error } = await supabase
        .from('important_dates')
        .select('*')
        .or(`and(recurrence.eq.none,event_date.eq.${targetDate.toISOString().split('T')[0]}),and(recurrence.eq.yearly)`)
        .contains('reminder_days', [daysAhead]);

      if (error) {
        console.error('[relationship_radar] Query error:', error);
        continue;
      }

      for (const dateEvent of dates || []) {
        // For yearly events, check if month/day match
        if (dateEvent.recurrence === 'yearly') {
          const eventDate = new Date(dateEvent.event_date);
          if (eventDate.getMonth() + 1 !== targetMonth || eventDate.getDate() !== targetDay) {
            continue;
          }
        }

        // Check if already reminded at this tier recently
        if (dateEvent.last_reminded_days === daysAhead) {
          const lastReminded = new Date(dateEvent.last_reminded_at);
          const hoursSinceReminder = (today.getTime() - lastReminded.getTime()) / (1000 * 60 * 60);
          if (hoursSinceReminder < 23) {
            // Already reminded today at this tier
            continue;
          }
        }

        // Determine who to notify
        const targetUserId = dateEvent.partner_user_id || dateEvent.user_id;

        // Create appropriate message based on days
        let message: string;
        const eventName = dateEvent.event_name;
        const relatedPerson = dateEvent.related_person;

        if (daysAhead === 1) {
          message = `Tomorrow is ${eventName}${relatedPerson ? ` for ${relatedPerson}` : ''}! Don't forget!`;
        } else if (daysAhead === 3) {
          message = `${eventName}${relatedPerson ? ` for ${relatedPerson}` : ''} is in 3 days. Time to prepare!`;
        } else if (daysAhead === 7) {
          message = `${eventName}${relatedPerson ? ` for ${relatedPerson}` : ''} is coming up in a week. Have you planned something?`;
        } else {
          message = `Heads up! ${eventName}${relatedPerson ? ` for ${relatedPerson}` : ''} is in 2 weeks.`;
        }

        const emoji = dateEvent.event_type === 'birthday' ? '🎂' :
                      dateEvent.event_type === 'anniversary' ? '💕' :
                      dateEvent.event_type === 'holiday' ? '🎉' : '📅';

        notifications.push({
          user_id: targetUserId,
          couple_id: dateEvent.couple_id,
          type: 'date_reminder',
          title: `${emoji} ${eventName} Coming Up!`,
          message,
          priority: daysAhead <= 3 ? 9 : 6,
          source_type: 'important_date',
          source_id: dateEvent.id,
          metadata: {
            date_id: dateEvent.id,
            event_name: eventName,
            event_type: dateEvent.event_type,
            event_date: dateEvent.event_date,
            days_until: daysAhead,
            related_person: relatedPerson,
            gift_ideas: dateEvent.gift_ideas
          }
        });

        // Update last reminded
        await supabase
          .from('important_dates')
          .update({
            last_reminded_at: new Date().toISOString(),
            last_reminded_days: daysAhead
          })
          .eq('id', dateEvent.id);
      }
    }

    // Insert notifications
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notifError) {
        console.error('[relationship_radar] Notification error:', notifError);
      } else {
        console.log('[relationship_radar] Created', notifications.length, 'reminders');
      }
    }

    const result = {
      dates_checked: notifications.length,
      reminders_sent: notifications.length
    };

    await completeModuleLog(supabase, logId, 'completed', result);

    return {
      processed: notifications.length,
      alerts: notifications.length
    };

  } catch (error: any) {
    console.error('[relationship_radar] Error:', error);
    await completeModuleLog(supabase, logId, 'failed', { error: error.message });
    return { processed: 0, alerts: 0, errors: [error.message] };
  }
}

// ============================================================================
// MODULE C: WEEKEND PLANNER
// ============================================================================
// On Thursdays, suggests weekend activities based on weather and saved ideas

async function runWeekendPlanner(supabase: SupabaseClient): Promise<ModuleResult> {
  const logId = await startModuleLog(supabase, 'daily-pulse', 'weekend_planner');

  try {
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Only run on Thursdays (4 = Thursday)
    if (dayOfWeek !== 4) {
      console.log('[weekend_planner] Not Thursday, skipping');
      await completeModuleLog(supabase, logId, 'skipped', { reason: 'Not Thursday' });
      return { processed: 0, alerts: 0, skipped: 1 };
    }

    console.log('[weekend_planner] Running Thursday weekend planning');

    // Get users with proactive messaging enabled
    const { data: preferences, error: prefError } = await supabase
      .from('olive_user_preferences')
      .select('user_id, timezone, proactive_topics')
      .eq('proactive_enabled', true);

    if (prefError || !preferences || preferences.length === 0) {
      console.log('[weekend_planner] No users with proactive enabled');
      await completeModuleLog(supabase, logId, 'completed', { users_checked: 0 });
      return { processed: 0, alerts: 0 };
    }

    const notifications: Notification[] = [];

    for (const pref of preferences) {
      try {
        // Get user's outdoor/weekend activity ideas
        const { data: activityNotes } = await supabase
          .from('clerk_notes')
          .select('id, summary, category, tags')
          .eq('user_id', pref.user_id)
          .eq('completed', false)
          .or('category.eq.date_ideas,category.eq.entertainment,tags.cs.{outdoor},tags.cs.{weekend}')
          .limit(10);

        if (!activityNotes || activityNotes.length === 0) {
          continue;
        }

        // Pick a random activity to suggest
        const randomActivity = activityNotes[Math.floor(Math.random() * activityNotes.length)];

        // NOTE: Weather API integration would go here
        // For now, we create a generic weekend suggestion
        // In production, integrate with:
        // - OpenWeatherMap API
        // - Weather.gov API

        notifications.push({
          user_id: pref.user_id,
          type: 'weekend_suggestion',
          title: '☀️ Weekend is Coming!',
          message: `It's almost the weekend! How about "${randomActivity.summary}"? You saved this as something you wanted to do.`,
          priority: 4,
          source_type: 'note',
          source_id: randomActivity.id,
          metadata: {
            suggested_activity: randomActivity.summary,
            note_id: randomActivity.id,
            category: randomActivity.category
          }
        });

      } catch (userError: any) {
        console.error('[weekend_planner] User error:', pref.user_id, userError);
      }
    }

    // Insert notifications
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notifError) {
        console.error('[weekend_planner] Notification error:', notifError);
      }
    }

    const result = {
      users_checked: preferences.length,
      suggestions_made: notifications.length
    };

    await completeModuleLog(supabase, logId, 'completed', result);

    return {
      processed: preferences.length,
      alerts: notifications.length
    };

  } catch (error: any) {
    console.error('[weekend_planner] Error:', error);
    await completeModuleLog(supabase, logId, 'failed', { error: error.message });
    return { processed: 0, alerts: 0, errors: [error.message] };
  }
}

// ============================================================================
// MODULE D: STALE TASK REAPER
// ============================================================================
// Flags tasks that have been incomplete for over 30 days

async function runStaleTaskReaper(supabase: SupabaseClient): Promise<ModuleResult> {
  const logId = await startModuleLog(supabase, 'daily-pulse', 'stale_task_reaper');

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Find stale incomplete tasks (no due date, created over 30 days ago)
    const { data: staleTasks, error } = await supabase
      .from('clerk_notes')
      .select('id, user_id, summary, created_at, couple_id, category')
      .eq('completed', false)
      .is('due_date', null)
      .lt('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('[stale_task_reaper] Query error:', error);
      await completeModuleLog(supabase, logId, 'failed', { error: error.message });
      return { processed: 0, alerts: 0, errors: [error.message] };
    }

    if (!staleTasks || staleTasks.length === 0) {
      console.log('[stale_task_reaper] No stale tasks found');
      await completeModuleLog(supabase, logId, 'completed', { stale_tasks_found: 0 });
      return { processed: 0, alerts: 0 };
    }

    console.log('[stale_task_reaper] Found', staleTasks.length, 'stale tasks');

    // Group by user
    const tasksByUser: Record<string, typeof staleTasks> = {};
    for (const task of staleTasks) {
      if (!tasksByUser[task.user_id]) {
        tasksByUser[task.user_id] = [];
      }
      tasksByUser[task.user_id].push(task);
    }

    const notifications: Notification[] = [];

    for (const [userId, tasks] of Object.entries(tasksByUser)) {
      const taskList = tasks.slice(0, 5).map(t => `• ${t.summary}`).join('\n');
      const moreCount = tasks.length > 5 ? tasks.length - 5 : 0;

      let message = `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} over 30 days old:\n\n${taskList}`;
      if (moreCount > 0) {
        message += `\n\n...and ${moreCount} more`;
      }
      message += '\n\nWant to complete, reschedule, or remove them?';

      notifications.push({
        user_id: userId,
        type: 'stale_task',
        title: '🧹 Time for a Task Cleanup?',
        message,
        priority: 3,
        metadata: {
          stale_task_ids: tasks.map(t => t.id),
          task_count: tasks.length,
          oldest_task_date: tasks[0].created_at
        }
      });
    }

    // Insert notifications
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);

      if (notifError) {
        console.error('[stale_task_reaper] Notification error:', notifError);
      }
    }

    const result = {
      stale_tasks_found: staleTasks.length,
      users_notified: notifications.length
    };

    await completeModuleLog(supabase, logId, 'completed', result);

    return {
      processed: staleTasks.length,
      alerts: notifications.length
    };

  } catch (error: any) {
    console.error('[stale_task_reaper] Error:', error);
    await completeModuleLog(supabase, logId, 'failed', { error: error.message });
    return { processed: 0, alerts: 0, errors: [error.message] };
  }
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================

async function startModuleLog(
  supabase: SupabaseClient,
  jobType: string,
  module: string
): Promise<string> {
  try {
    const { data } = await supabase.rpc('log_operation_start', {
      p_job_type: jobType,
      p_module: module
    });
    return data || '';
  } catch (error) {
    console.warn('[logging] Failed to start log:', error);
    return '';
  }
}

async function completeModuleLog(
  supabase: SupabaseClient,
  logId: string,
  status: string,
  details: Record<string, any>,
  userIds?: string[]
): Promise<void> {
  if (!logId) return;

  try {
    await supabase.rpc('log_operation_complete', {
      p_log_id: logId,
      p_status: status,
      p_details: details,
      p_user_ids: userIds || null
    });
  } catch (error) {
    console.warn('[logging] Failed to complete log:', error);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[daily-pulse] Starting daily pulse job...');

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase configuration is missing');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check for optional module filter in request
    let body: { modules?: string[] } = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON is fine
    }

    const runModules = body.modules || ['wishlist', 'dates', 'weekend', 'staleTasks'];

    const results: PulseResults = {
      wishlist: { processed: 0, alerts: 0 },
      dates: { processed: 0, alerts: 0 },
      weekend: { processed: 0, alerts: 0 },
      staleTasks: { processed: 0, alerts: 0 }
    };

    // Run modules in parallel
    const modulePromises: Promise<void>[] = [];

    if (runModules.includes('wishlist')) {
      modulePromises.push(
        runWishlistMonitor(supabase).then(r => { results.wishlist = r; })
      );
    }

    if (runModules.includes('dates')) {
      modulePromises.push(
        runRelationshipRadar(supabase).then(r => { results.dates = r; })
      );
    }

    if (runModules.includes('weekend')) {
      modulePromises.push(
        runWeekendPlanner(supabase).then(r => { results.weekend = r; })
      );
    }

    if (runModules.includes('staleTasks')) {
      modulePromises.push(
        runStaleTaskReaper(supabase).then(r => { results.staleTasks = r; })
      );
    }

    // Wait for all modules to complete
    await Promise.allSettled(modulePromises);

    const duration = Date.now() - startTime;
    console.log('[daily-pulse] Completed in', duration, 'ms');
    console.log('[daily-pulse] Results:', JSON.stringify(results));

    // Log overall job completion
    try {
      const { data: logId } = await supabase.rpc('log_operation_start', {
        p_job_type: 'daily-pulse',
        p_module: 'main'
      });

      if (logId) {
        await supabase.rpc('log_operation_complete', {
          p_log_id: logId,
          p_status: 'completed',
          p_details: { results, duration_ms: duration }
        });
      }
    } catch (logError) {
      console.warn('[daily-pulse] Failed to log overall completion:', logError);
    }

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[daily-pulse] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Unknown error occurred',
      duration_ms: Date.now() - startTime
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
