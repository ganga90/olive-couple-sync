/**
 * Olive Billing — Pricing, Subscriptions & Usage Metering
 *
 * Manages pricing plans, subscription lifecycle, usage tracking,
 * and quota enforcement. Integrates with Stripe for payment processing.
 *
 * Actions:
 * - get_plans: List available pricing plans
 * - get_subscription: Get user's current subscription
 * - create_checkout: Create a Stripe checkout session
 * - webhook: Handle Stripe webhooks
 * - get_usage: Get current period usage metrics
 * - check_quota: Check if user can perform an action
 * - increment_usage: Record a usage event
 * - cancel: Cancel subscription
 * - portal: Create Stripe customer portal session
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (action) {
      case "get_plans":
        return json(await getPlans(supabase));
      case "get_subscription":
        return json(await getSubscription(supabase, userId));
      case "create_checkout":
        return json(await createCheckout(supabase, body, userId));
      case "get_usage":
        return json(await getUsage(supabase, userId));
      case "check_quota":
        return json(await checkQuota(supabase, body, userId));
      case "increment_usage":
        return json(await incrementUsage(supabase, body, userId));
      case "cancel":
        return json(await cancelSubscription(supabase, userId));
      case "portal":
        return json(await createPortal(supabase, userId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-billing error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── Get Plans ───────────────────────────────────────────────

async function getPlans(supabase: any) {
  const { data, error } = await supabase
    .from("olive_pricing_plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) throw error;
  return { plans: data };
}

// ─── Get Subscription ────────────────────────────────────────

async function getSubscription(supabase: any, userId: string | null) {
  if (!userId) return { subscription: null, plan: null };

  const { data: sub } = await supabase
    .from("olive_subscriptions")
    .select(`*, plan:olive_pricing_plans(*)`)
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  if (!sub) {
    // Return free plan details
    const { data: freePlan } = await supabase
      .from("olive_pricing_plans")
      .select("*")
      .eq("plan_id", "free")
      .single();

    return { subscription: null, plan: freePlan };
  }

  return { subscription: sub, plan: sub.plan };
}

// ─── Create Checkout ─────────────────────────────────────────

async function createCheckout(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { plan_id, billing_cycle = "monthly" } = body;
  if (!plan_id) return { error: "plan_id required" };

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    // In beta mode, just create the subscription directly
    const { error } = await supabase.from("olive_subscriptions").upsert({
      user_id: userId,
      plan_id,
      status: "active",
      billing_cycle,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    }, { onConflict: "user_id" });

    if (error) throw error;
    return { success: true, mode: "beta", plan_id };
  }

  // Get plan's Stripe price ID
  const { data: plan } = await supabase
    .from("olive_pricing_plans")
    .select("*")
    .eq("plan_id", plan_id)
    .single();

  if (!plan) return { error: "Plan not found" };

  const priceId = billing_cycle === "yearly"
    ? plan.stripe_price_id_yearly
    : plan.stripe_price_id_monthly;

  if (!priceId) return { error: "Stripe pricing not configured for this plan" };

  // Create Stripe checkout session
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "mode": "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "success_url": `${Deno.env.get("APP_URL") || "https://app.olive.ai"}/settings?checkout=success`,
      "cancel_url": `${Deno.env.get("APP_URL") || "https://app.olive.ai"}/settings?checkout=canceled`,
      "client_reference_id": userId,
      "metadata[user_id]": userId,
      "metadata[plan_id]": plan_id,
    }),
  });

  const session = await response.json();
  if (session.error) throw new Error(session.error.message);

  return { checkout_url: session.url, session_id: session.id };
}

// ─── Get Usage ───────────────────────────────────────────────

async function getUsage(supabase: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };

  // Today's usage
  const { data: today } = await supabase
    .from("olive_usage_meters")
    .select("*")
    .eq("user_id", userId)
    .eq("meter_date", new Date().toISOString().split("T")[0])
    .maybeSingle();

  // This month's total
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);

  const { data: monthData } = await supabase
    .from("olive_usage_meters")
    .select("notes_created, ai_requests, whatsapp_messages_sent, file_uploads")
    .eq("user_id", userId)
    .gte("meter_date", firstOfMonth.toISOString().split("T")[0]);

  const monthTotals = (monthData || []).reduce(
    (acc: any, row: any) => ({
      notes_created: acc.notes_created + (row.notes_created || 0),
      ai_requests: acc.ai_requests + (row.ai_requests || 0),
      whatsapp_messages_sent: acc.whatsapp_messages_sent + (row.whatsapp_messages_sent || 0),
      file_uploads: acc.file_uploads + (row.file_uploads || 0),
    }),
    { notes_created: 0, ai_requests: 0, whatsapp_messages_sent: 0, file_uploads: 0 }
  );

  // Get plan limits
  const { plan } = await getSubscription(supabase, userId);

  return {
    today: today || { ai_requests: 0, whatsapp_messages_sent: 0, notes_created: 0 },
    month: monthTotals,
    limits: plan ? {
      max_notes_per_month: plan.max_notes_per_month,
      max_ai_requests_per_day: plan.max_ai_requests_per_day,
      max_whatsapp_messages_per_day: plan.max_whatsapp_messages_per_day,
    } : null,
  };
}

// ─── Check Quota ─────────────────────────────────────────────

async function checkQuota(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { meter } = body;
  if (!meter) return { error: "meter required" };

  const { data, error } = await supabase.rpc("check_quota", {
    p_user_id: userId,
    p_meter: meter,
  });

  if (error) throw error;
  const row = data?.[0] || { current_usage: 0, max_allowed: 0, is_within_quota: true };
  return row;
}

// ─── Increment Usage ─────────────────────────────────────────

async function incrementUsage(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { meter, amount = 1 } = body;
  if (!meter) return { error: "meter required" };

  const { error } = await supabase.rpc("increment_usage", {
    p_user_id: userId,
    p_meter: meter,
    p_amount: amount,
  });

  if (error) throw error;
  return { success: true };
}

// ─── Cancel Subscription ─────────────────────────────────────

async function cancelSubscription(supabase: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };

  const { data: sub } = await supabase
    .from("olive_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  if (!sub) return { error: "No active subscription" };

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (stripeKey && sub.stripe_subscription_id) {
    // Cancel at period end in Stripe
    await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "cancel_at_period_end=true",
    });
  }

  const { error } = await supabase
    .from("olive_subscriptions")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", sub.id);

  if (error) throw error;
  return { success: true, effective_until: sub.current_period_end };
}

// ─── Create Portal ───────────────────────────────────────────

async function createPortal(supabase: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };

  const { data: sub } = await supabase
    .from("olive_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!sub?.stripe_customer_id) return { error: "No Stripe customer found" };

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return { error: "Stripe not configured" };

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "customer": sub.stripe_customer_id,
      "return_url": `${Deno.env.get("APP_URL") || "https://app.olive.ai"}/settings`,
    }),
  });

  const session = await response.json();
  return { portal_url: session.url };
}
