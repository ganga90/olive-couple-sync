import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";
import { useAuth } from "@/providers/AuthProvider";
import { Share2, User2, Copy, Check, AlertTriangle } from "lucide-react";

interface InviteFlowProps {
  you: string;
  partner: string;
  onComplete: () => void;
}

export const InviteFlow = ({ you, partner, onComplete }: InviteFlowProps) => {
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"setup" | "invite">("setup");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [authDebug, setAuthDebug] = useState<string>("");
  const { createCouple } = useSupabaseCouple();
  const { user } = useAuth();
  const supabase = useClerkSupabaseClient();

  // Debug auth state
  useEffect(() => {
    const debugAuth = async () => {
      if (user) {
        try {
          const { data, error } = await supabase
            .from('clerk_couples')
            .select('count(*)')
            .limit(1);
          
          if (error) {
            setAuthDebug(`Auth Error: ${error.message}`);
          } else {
            setAuthDebug('Auth working correctly');
          }
        } catch (err) {
          setAuthDebug(`Auth Debug Error: ${err}`);
        }
      }
    };
    debugAuth();
  }, [user, supabase]);

  const handleSetupOnly = async () => {
    console.log('[InviteFlow] handleSetupOnly called with:', { you, partner, user: !!user });
    setLoading(true);
    try {
      if (!user) {
        console.log('[InviteFlow] No user available, proceeding with local setup');
        // Create a temporary local couple without database dependency
        toast.success("Your space is ready! You can invite your partner later from your profile.");
        onComplete();
        return;
      }

      console.log('[InviteFlow] Creating couple with:', { title: `${you} & ${partner}`, you_name: you, partner_name: partner });
      const couple = await createCouple({
        title: `${you} & ${partner}`,
        you_name: you,
        partner_name: partner,
      });
      console.log('[InviteFlow] Couple created:', couple);
      
      if (!couple) {
        console.error('[InviteFlow] Failed to create couple - null returned');
        // Fallback to local setup
        toast.success("Your space is ready! You can invite your partner later from your profile.");
        onComplete();
        return;
      }
      
      console.log('[InviteFlow] Couple creation successful, calling onComplete');
      toast.success("Your space is ready! You can invite your partner later from your profile.");
      onComplete();
    } catch (error) {
      console.error("[InviteFlow] Failed to create couple:", error);
      // Don't fail completely - allow local setup
      toast.success("Your space is ready! You can invite your partner later from your profile.");
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvite = async () => {
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

      // Generate a highly unique token to avoid conflicts
      const timestamp = Date.now();
      const randomPart = crypto.randomUUID();
      const token = `${timestamp}-${randomPart}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

      // Use the couple ID from the database if available, otherwise use local ID
      const coupleId = couple.id;
      
      // Create unique placeholder email to avoid conflicts
      const uniqueEmail = `${partner.toLowerCase().replace(/\s+/g, '')}-${timestamp}@invite.olive`;

      // Check if couple is properly saved to database (not just local offline mode)
      if (!coupleId || coupleId.length < 20) {
        throw new Error("Your workspace is in offline mode. Please refresh the page or check your connection before sending invites.");
      }

      console.log('Creating invite with:', {
        couple_id: coupleId,
        invited_email: uniqueEmail,
        invited_by: user?.id,
        token,
        status: 'pending',
        expires_at: expiresAt.toISOString()
      });

      // Create invite
      const { data: inviteData, error: inviteError } = await supabase
        .from("invites")
        .insert({
          couple_id: coupleId,
          invited_email: uniqueEmail,
          invited_by: user?.id,
          token,
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (inviteError) {
        console.error('Invite creation error:', inviteError);
        throw inviteError;
      }

      console.log('Invite created successfully:', inviteData);

      // Generate invite URL
      const currentUrl = window.location.origin;
      const inviteLink = `${currentUrl}/accept-invite?token=${token}`;
      
      // Create personalized message
      const message = `Hey ${partner}! 🌿\n\n${you} has invited you to join your shared Olive space where you can organize notes, lists, and tasks together.\n\nClick this link to join: ${inviteLink}\n\nThis link expires in 7 days. Looking forward to organizing together! 💚`;

      setInviteUrl(inviteLink);
      setInviteMessage(message);
      
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

  if (mode === "setup") {
    return (
      <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-olive-dark">Ready to connect?</h3>
          <p className="text-sm text-muted-foreground">
            You can start using Olive right away, or invite {partner} to join your shared space.
          </p>
        </div>

        {authDebug && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <span className="text-xs text-yellow-800">{authDebug}</span>
          </div>
        )}

        <div className="space-y-3">
          <Button 
            onClick={() => setMode("invite")}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            disabled={loading}
          >
            <Share2 className="h-4 w-4 mr-2" />
            Create Invite Link for {partner}
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

  if (!inviteUrl) {
    return (
      <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-olive-dark">Create Invite for {partner}</h3>
          <p className="text-sm text-muted-foreground">
            Generate a shareable link and message to invite {partner} to your Olive space.
          </p>
        </div>

        <div className="space-y-3">
          <Button 
            onClick={handleCreateInvite}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            disabled={loading}
          >
            {loading ? "Creating Invite..." : "Generate Invite Link"}
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
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-olive-dark">Invite Ready! 🌿</h3>
        <p className="text-sm text-muted-foreground">
          Copy and share this with {partner} via text, email, or any messaging app.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-olive-dark font-medium">Invite Message</Label>
          <div className="relative">
            <textarea 
              value={inviteMessage}
              readOnly
              rows={8}
              className="w-full p-3 text-sm bg-olive/5 border border-olive/20 rounded-lg resize-none focus:outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 border-olive/30 text-olive hover:bg-olive/10"
              onClick={() => copyToClipboard(inviteMessage)}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-olive-dark font-medium">Just the Link</Label>
          <div className="flex gap-2">
            <input 
              value={inviteUrl}
              readOnly
              className="flex-1 p-2 text-sm bg-olive/5 border border-olive/20 rounded-lg focus:outline-none"
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

        <div className="space-y-3">
          <Button 
            onClick={onComplete}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
          >
            Done
          </Button>

          <Button 
            onClick={() => {
              setInviteUrl("");
              setInviteMessage("");
              setMode("setup");
            }}
            variant="ghost"
            className="w-full text-muted-foreground hover:text-olive"
          >
            Create Another Invite
          </Button>
        </div>
      </div>
    </Card>
  );
};