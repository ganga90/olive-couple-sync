import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { useAuth } from "@/providers/AuthProvider";
import { Mail, User2 } from "lucide-react";

interface InviteFlowProps {
  you: string;
  partner: string;
  onComplete: () => void;
}

export const InviteFlow = ({ you, partner, onComplete }: InviteFlowProps) => {
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"setup" | "invite">("setup");
  const { createCouple } = useSupabaseCouple();
  const { user } = useAuth();
  const supabase = useClerkSupabaseClient();

  const handleSetupOnly = async () => {
    setLoading(true);
    try {
      await createCouple({
        title: `${you} & ${partner}`,
        you_name: you,
        partner_name: partner,
      });
      toast.success("Your space is ready! You can invite your partner later from your profile.");
      onComplete();
    } catch (error) {
      console.error("Failed to create couple:", error);
      toast.error("Failed to set up your space. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail) {
      toast.error("Please enter your partner's email");
      return;
    }

    setLoading(true);
    try {
      // Create couple first
      const couple = await createCouple({
        title: `${you} & ${partner}`,
        you_name: you,
        partner_name: partner,
      });

      if (!couple) {
        throw new Error("Failed to create couple");
      }

      // Generate invite token
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      // Create invite
      const { error: inviteError } = await supabase
        .from("invites")
        .insert({
          couple_id: couple.id,
          invited_email: inviteEmail,
          invited_by: user?.id,
          token,
          expires_at: expiresAt.toISOString(),
          status: "pending" as const,
        });

      if (inviteError) {
        throw inviteError;
      }

      // Send invite email via edge function
      const { error: emailError } = await supabase.functions.invoke('send-invite', {
        body: {
          inviteEmail,
          partnerName: partner,
          coupleTitle: `${you} & ${partner}`,
          inviteToken: token,
        }
      });

      if (emailError) {
        console.warn("Failed to send invite email:", emailError);
        // Don't fail the whole process if email fails
      }

      toast.success(`Invite sent to ${inviteEmail}! They'll receive an email with a link to join.`);
      onComplete();
    } catch (error) {
      console.error("Failed to send invite:", error);
      toast.error("Failed to send invite. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "setup") {
    return (
      <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-olive-dark">Ready to connect?</h3>
          <p className="text-sm text-muted-foreground">
            You can start using Olive right away, or invite {partner} to join your shared space.
          </p>
        </div>

        <div className="space-y-3">
          <Button 
            onClick={() => setMode("invite")}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            disabled={loading}
          >
            <Mail className="h-4 w-4 mr-2" />
            Invite {partner} Now
          </Button>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white/80 px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button 
            onClick={handleSetupOnly}
            variant="outline"
            className="w-full border-olive/30 text-olive hover:bg-olive/10"
            disabled={loading}
          >
            <User2 className="h-4 w-4 mr-2" />
            Set Up My Space Only
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          You can always invite your partner later from your profile page.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-olive-dark">Invite {partner}</h3>
        <p className="text-sm text-muted-foreground">
          We'll send them an email with a link to join your shared Olive space.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite-email" className="text-olive-dark font-medium">
            {partner}'s email address
          </Label>
          <Input 
            id="invite-email"
            type="email"
            value={inviteEmail} 
            onChange={(e) => setInviteEmail(e.target.value)} 
            placeholder="partner@example.com"
            className="border-olive/30 focus:border-olive focus:ring-olive/20"
          />
        </div>

        <div className="space-y-3">
          <Button 
            onClick={handleSendInvite}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            disabled={loading || !inviteEmail}
          >
            {loading ? "Sending..." : "Send Invite"}
          </Button>

          <Button 
            onClick={() => setMode("setup")}
            variant="ghost"
            className="w-full text-muted-foreground hover:text-olive"
            disabled={loading}
          >
            Back
          </Button>
        </div>
      </div>
    </Card>
  );
};