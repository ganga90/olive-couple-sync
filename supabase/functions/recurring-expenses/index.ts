import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date().toISOString();

    // Find all recurring expenses that are due
    const { data: dueExpenses, error: fetchErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('is_recurring', true)
      .eq('is_settled', false)
      .lte('next_recurrence_date', now)
      .not('next_recurrence_date', 'is', null);

    if (fetchErr) {
      console.error('[recurring-expenses] Fetch error:', fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!dueExpenses || dueExpenses.length === 0) {
      console.log('[recurring-expenses] No recurring expenses due');
      return new Response(JSON.stringify({ created: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[recurring-expenses] Processing ${dueExpenses.length} recurring expenses`);

    let created = 0;

    for (const expense of dueExpenses) {
      // Create the new expense instance
      const { error: insertErr } = await supabase.from('expenses').insert({
        user_id: expense.user_id,
        couple_id: expense.couple_id,
        name: expense.name,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        category_icon: expense.category_icon,
        split_type: expense.split_type,
        paid_by: expense.paid_by,
        is_shared: expense.is_shared,
        is_recurring: false, // The child is NOT recurring itself
        parent_recurring_id: expense.id,
        expense_date: expense.next_recurrence_date,
      });

      if (insertErr) {
        console.error(`[recurring-expenses] Insert error for ${expense.id}:`, insertErr);
        continue;
      }

      // Calculate next recurrence date
      const nextDate = new Date(expense.next_recurrence_date);
      const interval = expense.recurrence_interval || 1;

      switch (expense.recurrence_frequency) {
        case 'weekly':
          nextDate.setDate(nextDate.getDate() + 7 * interval);
          break;
        case 'monthly':
          nextDate.setMonth(nextDate.getMonth() + interval);
          break;
        case 'yearly':
          nextDate.setFullYear(nextDate.getFullYear() + interval);
          break;
      }

      // Update the parent recurring expense with the next date
      await supabase
        .from('expenses')
        .update({ next_recurrence_date: nextDate.toISOString() })
        .eq('id', expense.id);

      created++;
    }

    console.log(`[recurring-expenses] Created ${created} expenses`);
    return new Response(JSON.stringify({ created }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[recurring-expenses] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
