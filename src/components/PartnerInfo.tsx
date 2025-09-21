import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";
import { User2, Share2, Plus, Check, Clock, X, Copy, Trash2, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const PartnerInfo = () => {
  const [loading, setLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const { currentCouple, you, partner, refetch } = useSupabaseCouple();
  const { user } = useAuth();
  const navigate = useNavigate();
  

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

      const supabase = getSupabase();
      const { data: inviteData, error: inviteError } = await supabase.rpc('create_invite', {
        p_couple_id: currentCouple.id,
      });

      if (inviteError) {
        console.error('Invite creation error:', inviteError);
        throw inviteError;
      }

      console.log('Invite created successfully with data:', inviteData);

      // Extract token from the returned jsonb object
      const inviteToken = inviteData?.token;
      if (!inviteToken) {
        throw new Error('Failed to get invite token from response');
      }

      // Generate invite URL
      const currentUrl = window.location.origin;
      const inviteLink = `${currentUrl}/accept-invite?token=${inviteToken}`;
      
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

  const handleUnlinkSpace = async () => {
    if (!currentCouple || !user) {
      toast.error("Unable to unlink - missing couple or user information");
      return;
    }

    setUnlinkLoading(true);
    try {
      const supabase = getSupabase();
      
      // First, move user's notes from shared space to private space
      console.log("Moving user's notes to private space...");
      const { data: movedNotes, error: notesError } = await supabase
        .from("clerk_notes")
        .update({ couple_id: null }) // Set to null for private notes
        .eq("couple_id", currentCouple.id)
        .eq("author_id", user.id)
        .select();

      if (notesError) {
        console.error("Error moving notes to private space:", notesError);
        throw notesError;
      }

      const notesCount = movedNotes?.length || 0;
      console.log(`Successfully moved ${notesCount} notes to private space`);

      // Then remove user from couple members
      const { error: memberError } = await supabase
        .from("clerk_couple_members")
        .delete()
        .eq("couple_id", currentCouple.id)
        .eq("user_id", user.id);

      if (memberError) {
        console.error("Error removing user from couple:", memberError);
        throw memberError;
      }

      if (notesCount > 0) {
        toast.success(`Successfully unlinked from couple space! ${notesCount} of your notes have been moved to your private space.`);
      } else {
        toast.success("Successfully unlinked from couple space!");
      }
      
      // Refetch couple data to update the UI
      await refetch();
      
      // Navigate to onboarding to create a new space
      navigate("/onboarding");
      
    } catch (error) {
      console.error("Failed to unlink from couple:", error);
      toast.error("Failed to unlink from couple space. Please try again.");
    } finally {
      setUnlinkLoading(false);
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

        {/* Delete Space Section */}
        <div className="border-t pt-4 space-y-3">
          <Label className="text-sm font-medium text-destructive">Danger Zone</Label>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Unlink from this couple space. This will remove you from the shared space and you can create a new one.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={unlinkLoading}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {unlinkLoading ? "Unlinking..." : "Unlink from Space"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-white border-olive/20">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    Unlink from Couple Space?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <p>
                      This will remove you from the "{currentCouple.title || `${you} & ${partner}`}" space.
                    </p>
                    <p className="font-medium">
                      You will lose access to all shared notes and lists in this space.
                    </p>
                    <p>
                      After unlinking, you'll be able to create a new couple space or continue with a personal space.
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={handleUnlinkSpace}
                    className="bg-destructive hover:bg-destructive/90"
                    disabled={unlinkLoading}
                  >
                    {unlinkLoading ? "Unlinking..." : "Yes, Unlink"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </Card>
  );
};