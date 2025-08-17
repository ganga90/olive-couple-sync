import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendInviteRequest {
  inviteEmail: string;
  partnerName: string;
  coupleTitle: string;
  inviteToken: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { inviteEmail, partnerName, coupleTitle, inviteToken }: SendInviteRequest = await req.json();

    console.log(`Sending invite to ${inviteEmail} for couple ${coupleTitle}`);

    // Construct invite URL - using the current deployment URL
    const inviteUrl = `${req.url.split('/functions/')[0]}/accept-invite?token=${inviteToken}`;

    // For now, we'll just log the invite details
    // In a real implementation, you would integrate with a service like Resend
    console.log(`Invite URL: ${inviteUrl}`);
    console.log(`Partner Name: ${partnerName}`);
    console.log(`Couple Title: ${coupleTitle}`);

    // Return success response with invite details for testing
    return new Response(JSON.stringify({
      success: true,
      message: `Invite would be sent to ${inviteEmail}`,
      inviteUrl,
      details: {
        partnerName,
        coupleTitle,
        inviteEmail
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-invite function:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);