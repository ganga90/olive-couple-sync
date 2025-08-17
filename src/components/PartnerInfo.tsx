import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { User2, Mail, Plus, Check, Clock, X } from "lucide-react";

export const PartnerInfo = () => {
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const { currentCouple, you, partner } = useSupabaseCouple();
  const supabase = useClerkSupabaseClient();

  const handleSendInvite = async () => {
    if (!inviteEmail || !currentCouple) {
      toast.error("Please enter a valid email");
      return;
    }

    setLoading(true);
    try {
      // Generate invite token
      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      // Create invite
      const { error: inviteError } = await supabase
        .from("invites")
        .insert({
          couple_id: currentCouple.id,
          invited_email: inviteEmail,
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
          coupleTitle: currentCouple.title || `${you} & ${partner}`,
          inviteToken: token,
        }
      });

      if (emailError) {
        console.warn("Failed to send invite email:", emailError);
        // Don't fail the whole process if email fails
      }

      toast.success(`Invite sent to ${inviteEmail}!`);
      setInviteEmail("");
      setShowInviteForm(false);
    } catch (error) {
      console.error("Failed to send invite:", error);
      toast.error("Failed to send invite. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return <Badge variant="default" className="bg-green-100 text-green-800 border-green-200"><Check className="h-3 w-3 mr-1" />Connected</Badge>;
      case "pending":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "expired":
        return <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200"><X className="h-3 w-3 mr-1" />Expired</Badge>;
      default:
        return null;
    }
  };

  if (!currentCouple) {
    return (
      <Card className="p-6 bg-white/50 border-olive/20 shadow-soft">
        <div className="text-center space-y-4">
          <User2 className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No couple space found</h3>
            <p className="text-sm text-muted-foreground">
              Set up your couple space to start sharing notes and lists.
            </p>
          </div>
          <Button 
            onClick={() => window.location.href = "/onboarding"}
            className="bg-olive hover:bg-olive/90 text-white"
          >
            Set Up Space
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Your Couple Space</h3>
        <p className="text-sm text-muted-foreground">
          {currentCouple.title || `${you} & ${partner}`}
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">You</Label>
            <p className="text-sm font-medium">{you || "Not set"}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Partner</Label>
            <p className="text-sm font-medium">{partner || "Not set"}</p>
          </div>
        </div>

        {/* Invite Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Partner Connection</Label>
            {!showInviteForm && (
              <Button 
                onClick={() => setShowInviteForm(true)}
                size="sm"
                variant="outline"
                className="text-olive border-olive/30 hover:bg-olive/10"
              >
                <Plus className="h-4 w-4 mr-1" />
                Invite Partner
              </Button>
            )}
          </div>

          {showInviteForm && (
            <div className="space-y-3 p-4 bg-olive/5 rounded-lg border border-olive/20">
              <div className="space-y-2">
                <Label htmlFor="partner-email" className="text-sm">Partner's email</Label>
                <Input
                  id="partner-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="partner@example.com"
                  className="border-olive/30 focus:border-olive focus:ring-olive/20"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleSendInvite}
                  size="sm"
                  className="bg-olive hover:bg-olive/90 text-white"
                  disabled={loading || !inviteEmail}
                >
                  <Mail className="h-4 w-4 mr-1" />
                  {loading ? "Sending..." : "Send Invite"}
                </Button>
                <Button 
                  onClick={() => {
                    setShowInviteForm(false);
                    setInviteEmail("");
                  }}
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};