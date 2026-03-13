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
import { User2, Share2, Plus, Check, Copy, Trash2, AlertTriangle, Crown, Users, UserMinus } from "lucide-react";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { useLanguage } from "@/providers/LanguageProvider";
import { useTranslation } from "react-i18next";

export const SpaceMembersCard = () => {
  const { t } = useTranslation('profile');
  const [loading, setLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const { currentCouple, you, partner, members, refetch } = useSupabaseCouple();
  const { user } = useAuth();
  const navigate = useLocalizedNavigate();
  const { getLocalizedPath } = useLanguage();

  const isOwner = members.find(m => m.user_id === user?.id)?.role === 'owner';
  const maxMembers = currentCouple?.max_members || 10;
  const memberCount = members.length;

  const handleCreateInvite = async () => {
    if (!currentCouple || loading) return;

    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: inviteData, error: inviteError } = await supabase.rpc('create_invite', {
        p_couple_id: currentCouple.id,
      });

      if (inviteError) throw inviteError;

      const inviteToken = inviteData?.token;
      if (!inviteToken) throw new Error('Failed to get invite token');

      const currentUrl = window.location.origin;
      const inviteLink = `${currentUrl}/accept-invite?token=${inviteToken}`;

      const message = `Hey! 🌿\n\n${you || 'Someone'} has invited you to join their shared Olive space.\n\nClick this link to join: ${inviteLink}\n\nThis link expires in 7 days. 💚`;

      setInviteUrl(inviteLink);
      setInviteMessage(message);
      toast.success(t('partnerInfo.inviteCreated', 'Invite link created!'));
    } catch (error) {
      console.error("Failed to create invite:", error);
      toast.error(t('partnerInfo.inviteError', 'Failed to create invite. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t('partnerInfo.copied', 'Copied to clipboard!'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('partnerInfo.copyError', 'Failed to copy to clipboard'));
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === user?.id) return;
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("clerk_couple_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
      toast.success(t('partnerInfo.memberRemoved', 'Member removed'));
      await refetch();
    } catch (error) {
      console.error("Failed to remove member:", error);
      toast.error(t('partnerInfo.removeError', 'Failed to remove member'));
    }
  };

  const handleUnlinkSpace = async () => {
    if (!currentCouple || !user) return;

    // Prevent owner from leaving if there are other members without another owner
    if (isOwner && memberCount > 1) {
      const otherOwners = members.filter(m => m.user_id !== user.id && m.role === 'owner');
      if (otherOwners.length === 0) {
        toast.error(t('partnerInfo.mustTransferOwnership', 'You must transfer ownership to another member before leaving.'));
        return;
      }
    }

    setUnlinkLoading(true);
    try {
      const supabase = getSupabase();

      await supabase
        .from("clerk_notes")
        .update({ couple_id: null })
        .eq("couple_id", currentCouple.id)
        .eq("author_id", user.id);

      await supabase
        .from("clerk_couple_members")
        .delete()
        .eq("couple_id", currentCouple.id)
        .eq("user_id", user.id);

      // If owner is the last member, delete the space entirely
      if (memberCount <= 1) {
        await supabase
          .from("clerk_couples")
          .delete()
          .eq("id", currentCouple.id);
      }

      localStorage.removeItem('olive_current_couple');
      toast.success(t('partnerInfo.leftSpace', 'Successfully left the space!'));
      await refetch();
      setTimeout(() => navigate("/onboarding"), 1000);
    } catch (error) {
      console.error("Failed to unlink:", error);
      toast.error(t('partnerInfo.leaveError', 'Failed to leave space. Please try again.'));
    } finally {
      setUnlinkLoading(false);
    }
  };

  if (!currentCouple) {
    return (
      <Card className="p-6 bg-card/50 border-border/30 shadow-soft">
        <div className="text-center space-y-4">
          <User2 className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">{t('partnerInfo.noCoupleSpace')}</h3>
            <p className="text-sm text-muted-foreground">{t('partnerInfo.setupDescription')}</p>
          </div>
          <Button onClick={() => navigate("/onboarding")} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {t('partnerInfo.setupButton')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card/50 border-border/30 shadow-soft space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{currentCouple.title || t('partnerInfo.sharedSpace', 'Shared Space')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('partnerInfo.memberCount', '{{count}}/{{max}} members', { count: memberCount, max: maxMembers })}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          <Users className="w-3 h-3 mr-1" />
          {memberCount}
        </Badge>
      </div>

      {/* Members List */}
      <div className="space-y-2">
        {members.map((member) => (
          <div key={member.member_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                {member.display_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {member.display_name}
                  {member.user_id === user?.id && <span className="text-muted-foreground ml-1">({t('partnerInfo.you')})</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {member.role === 'owner' && (
                <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                  <Crown className="w-3 h-3 mr-1" />
                  {t('partnerInfo.owner', 'Owner')}
                </Badge>
              )}
              {isOwner && member.user_id !== user?.id && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t('partnerInfo.removeMemberTitle', 'Remove {{name}}?', { name: member.display_name })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('partnerInfo.removeMemberDesc', 'This will remove them from the space. Their personal notes will be preserved.')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('partnerInfo.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleRemoveMember(member.member_id, member.user_id)} className="bg-destructive hover:bg-destructive/90">
                        {t('partnerInfo.remove', 'Remove')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Invite Section */}
      {memberCount < maxMembers && (
        <div className="space-y-3">
          {!showInviteForm && !inviteUrl && (
            <Button onClick={() => setShowInviteForm(true)} size="sm" variant="outline" className="w-full">
              <Plus className="h-4 w-4 mr-1" />
              {t('partnerInfo.inviteMember', 'Invite Member')}
            </Button>
          )}

          {showInviteForm && !inviteUrl && (
            <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-sm text-muted-foreground">
                {t('partnerInfo.createInviteDescription')}
              </p>
              <div className="flex gap-2">
                <Button onClick={handleCreateInvite} size="sm" disabled={loading}>
                  <Share2 className="h-4 w-4 mr-1" />
                  {loading ? t('partnerInfo.creating') : t('partnerInfo.createInviteButton')}
                </Button>
                <Button onClick={() => setShowInviteForm(false)} size="sm" variant="ghost" disabled={loading}>
                  {t('partnerInfo.cancel')}
                </Button>
              </div>
            </div>
          )}

          {inviteUrl && (
            <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('partnerInfo.inviteMessage')}</Label>
                <div className="relative">
                  <textarea value={inviteMessage} readOnly rows={5} className="w-full p-2 text-xs bg-background border rounded resize-none" />
                  <Button size="sm" variant="outline" className="absolute top-1 right-1 h-7 w-7 p-0" onClick={() => copyToClipboard(inviteMessage)}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <input value={inviteUrl} readOnly className="flex-1 p-2 text-xs bg-background border rounded" />
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(inviteUrl)}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t('partnerInfo.expiresIn7Days', 'This link expires in 7 days')}
              </p>
              <Button onClick={() => { setInviteUrl(""); setInviteMessage(""); setShowInviteForm(false); }} size="sm" variant="ghost" className="w-full">
                {t('partnerInfo.done', 'Done')}
              </Button>
            </div>
          )}
        </div>
      )}

      {memberCount >= maxMembers && (
        <p className="text-xs text-muted-foreground text-center">
          {t('partnerInfo.atCapacity', 'Space is at capacity ({{max}} members)', { max: maxMembers })}
        </p>
      )}

      {/* Leave Space */}
      <div className="border-t border-border/30 pt-4 space-y-3">
        <Label className="text-sm font-medium text-destructive">{t('partnerInfo.dangerZone')}</Label>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10" disabled={unlinkLoading}>
              <Trash2 className="h-4 w-4 mr-1" />
              {unlinkLoading ? t('partnerInfo.unlinking') : t('partnerInfo.unlinkButton')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {t('partnerInfo.unlinkConfirmTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>{t('partnerInfo.unlinkConfirmDesc1', { spaceName: currentCouple.title })}</p>
                <p className="font-medium">{t('partnerInfo.unlinkConfirmDesc2')}</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('partnerInfo.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleUnlinkSpace} className="bg-destructive hover:bg-destructive/90" disabled={unlinkLoading}>
                {t('partnerInfo.yesUnlink')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
};

// Keep old export for backward compat
export const PartnerInfo = SpaceMembersCard;
