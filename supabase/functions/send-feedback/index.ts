import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FEEDBACK_EMAIL = "gianluca@witholive.app";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { category, message, contactEmail, userName, userId, page, userAgent } = await req.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a nicely formatted email body
    const isBetaRequest = category === "beta_request";
    const subject = isBetaRequest
      ? `🫒 Beta Access Request — ${userName || "Unknown"}`
      : `🫒 Olive Feedback [${category || "general"}] — ${userName || "Anonymous"}`;

    const body = [
      isBetaRequest ? "=== BETA ACCESS REQUEST ===" : "=== OLIVE FEEDBACK ===",
      "",
      `From: ${userName || "Anonymous"}`,
      `Email: ${contactEmail || "Not provided"}`,
      `User ID: ${userId || "anonymous"}`,
      `Category: ${category || "general"}`,
      `Page: ${page || "unknown"}`,
      `Date: ${new Date().toISOString()}`,
      "",
      "--- Message ---",
      message.trim(),
      "",
      "--- Device ---",
      userAgent || "Unknown",
    ].join("\n");

    // Use Supabase's built-in SMTP or a simple fetch to an email API
    // For beta, we use Resend / a simple webhook approach
    // Since we don't have Resend set up, we'll store in DB and use a simpler approach
    
    // Store feedback in a lightweight way using Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Store the feedback/request
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/beta_feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        category: category || "general",
        message: message.trim().substring(0, 5000),
        contact_email: (contactEmail || "").substring(0, 255),
        user_name: (userName || "Anonymous").substring(0, 100),
        user_id: (userId || "anonymous").substring(0, 100),
        page: (page || "").substring(0, 255),
        user_agent: (userAgent || "").substring(0, 500),
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("[send-feedback] DB insert failed:", errText);
      // Don't fail the whole request — still try email
    }

    // Try sending email via a simple SMTP-compatible approach
    // Using the Resend API if available, otherwise just log
    const resendKey = Deno.env.get("RESEND_API_KEY");
    
    if (resendKey) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Olive Feedback <feedback@witholive.app>",
          to: [FEEDBACK_EMAIL],
          subject,
          text: body,
          reply_to: contactEmail || undefined,
        }),
      });

      if (!emailRes.ok) {
        console.error("[send-feedback] Email send failed:", await emailRes.text());
      }
    } else {
      // Fallback: log the feedback (it's already stored in DB)
      console.log("[send-feedback] No RESEND_API_KEY, feedback stored in DB only");
      console.log("[send-feedback] Subject:", subject);
      console.log("[send-feedback] Body:", body);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-feedback] Error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
