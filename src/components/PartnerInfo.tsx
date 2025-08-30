import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";
import { User2, Share2, Plus, Check, Clock, X, Copy } from "lucide-react";

export const PartnerInfo = () => {
  const [loading, setLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const { currentCouple, you, partner } = useSupabaseCouple();
  const { user } = useAuth();
  

  const handleCreateInvite = async () => {
    if (!currentCouple) {
      toast.error("No couple space found");
      return;
    }

    if (loading) {
      console.log('Invite creation already in progress, ignoring duplicate request');
      return;
    }

    setLoading(true);
    try {
      // Generate a highly unique token to avoid conflicts
      const timestamp = Date.now();
      const randomPart = crypto.randomUUID();
      const token = `${timestamp}-${randomPart}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      // Create unique placeholder email to avoid conflicts
      const uniqueEmail = `${partner?.toLowerCase().replace(/\s+/g, '') || 'partner'}-${timestamp}@invite.olive`;

      console.log('Creating invite with:', {
        couple_id: currentCouple.id,
        invited_email: uniqueEmail,
        invited_by: user?.id,
        token,
        status: 'pending',
        expires_at: expiresAt.toISOString()
      });

      // Use the new RPC function for idempotent invite creation
      const { data: inviteData, error: inviteError } = await supabase
        .rpc('create_invite', {
          p_couple_id: currentCouple.id,
        });

      if (inviteError) {
        console.error('Invite creation error:', inviteError);
        throw inviteError;
      }

      console.log('Invite created successfully:', inviteData);

      // Generate invite URL
      const currentUrl = window.location.origin;
      const inviteLink = `${currentUrl}/accept-invite?token=${inviteData.token}`;
      
      // Create personalized message
      const message = `Hey ${partner || 'there'}! 🌿\n\n${you || 'Your partner'} has invited you to join your shared Olive space where you can organize notes, lists, and tasks together.\n\nClick this link to join: ${inviteLink}\n\nThis link expires in 7 days. Looking forward to organizing together! 💚`;

      setInviteUrl(inviteLink);
      setInviteMessage(message);
      
      toast.success("Invite link created! Copy and share it with your partner.");
    } catch (error) {
      console.error("Failed to create invite:", error);
      toast.error("Failed to create invite. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy to clipboard");
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

          {showInviteForm && !inviteUrl && (
            <div className="space-y-3 p-4 bg-olive/5 rounded-lg border border-olive/20">
              <p className="text-sm text-muted-foreground">
                Create a shareable link to invite your partner to this space.
              </p>
              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateInvite}
                  size="sm"
                  className="bg-olive hover:bg-olive/90 text-white"
                  disabled={loading}
                >
                  <Share2 className="h-4 w-4 mr-1" />
                  {loading ? "Creating..." : "Create Invite Link"}
                </Button>
                <Button 
                  onClick={() => {
                    setShowInviteForm(false);
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

          {inviteUrl && (
            <div className="space-y-3 p-4 bg-olive/5 rounded-lg border border-olive/20">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-olive-dark">Invite Message</Label>
                <div className="relative">
                  <textarea 
                    value={inviteMessage}
                    readOnly
                    rows={6}
                    className="w-full p-2 text-xs bg-white border border-olive/20 rounded resize-none focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute top-1 right-1 h-7 w-7 p-0 border-olive/30 text-olive hover:bg-olive/10"
                    onClick={() => copyToClipboard(inviteMessage)}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-olive-dark">Just the Link</Label>
                <div className="flex gap-2">
                  <input 
                    value={inviteUrl}
                    readOnly
                    className="flex-1 p-2 text-xs bg-white border border-olive/20 rounded focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-olive/30 text-olive hover:bg-olive/10"
                    onClick={() => copyToClipboard(inviteUrl)}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <Button 
                onClick={() => {
                  setInviteUrl("");
                  setInviteMessage("");
                  setShowInviteForm(false);
                }}
                size="sm"
                variant="ghost"
                className="w-full text-muted-foreground hover:text-olive"
              >
                Create Another Invite
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};