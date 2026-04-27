import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { getSupabase } from "@/lib/supabaseClient";
import { useAuth } from "@/providers/AuthProvider";
import { User2, Share2, Plus, Check, Copy, Trash2, AlertTriangle, Crown, Users, UserMinus, Clock, Pencil, X as XIcon } from "lucide-react";
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
  // Phase 3-4: rename + delete space
  const [renameMode, setRenameMode] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const { currentCouple, you, partner, members, refetch } = useSupabaseCouple();
  const { currentSpace, updateSpace, deleteSpace } = useSpace();
  const { user } = useAuth();
  const navigate = useLocalizedNavigate();
  const { getLocalizedPath } = useLanguage();

  const isOwner = members.find(m => m.user_id === user?.id)?.role === 'owner';
  const maxMembers = currentCouple?.max_members || currentSpace?.max_members || 10;
  const memberCount = members.length;
  const displayedTitle = currentSpace?.name || currentCouple?.title || t('partnerInfo.sharedSpace', 'Shared Space');

  // Keep the rename input synced with the current title whenever the user opens the editor.
  useEffect(() => {
    if (renameMode) setRenameValue(displayedTitle);
  }, [renameMode, displayedTitle]);

  // ── Phase 3-4: rename / delete handlers ────────────────────────────
  const handleRenameSave = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === displayedTitle) {
      setRenameMode(false);
      return;
    }
    if (!currentSpace?.id && !currentCouple?.id) return;
    setRenameSaving(true);
    try {
      // Prefer the SpaceProvider path (works for ALL space types). If
      // there's no olive_spaces row yet (rare legacy edge case), fall
      // back to updating clerk_couples.title for couple-type spaces.
      if (currentSpace?.id) {
        const updated = await updateSpace(currentSpace.id, { name: trimmed });
        if (!updated) throw new Error('updateSpace returned null');
      } else if (currentCouple?.id) {
        const supabase = getSupabase();
        const { error } = await supabase
          .from('clerk_couples')
          .update({ title: trimmed, updated_at: new Date().toISOString() })
          .eq('id', currentCouple.id);
        if (error) throw error;
      }
      toast.success(t('partnerInfo.renamed', { defaultValue: 'Space renamed' }));
      await refetch();
      setRenameMode(false);
    } catch (err) {
      console.error('[SpaceMembersCard] Rename failed:', err);
      toast.error(t('partnerInfo.renameError', { defaultValue: 'Could not rename. Try again.' }));
    } finally {
      setRenameSaving(false);
    }
  };

  const handleDeleteSpace = async () => {
    if (!currentSpace?.id) return;
    if (!isOwner) {
      toast.error(t('partnerInfo.deleteOnlyOwner', { defaultValue: 'Only the owner can delete a space.' }));
      return;
    }
    setDeleteLoading(true);
    try {
      const ok = await deleteSpace(currentSpace.id);
      if (ok) {
        localStorage.removeItem('olive_current_couple');
        localStorage.removeItem('olive_current_space');
        toast.success(t('partnerInfo.deleted', { defaultValue: 'Space deleted.' }));
        await refetch();
        setTimeout(() => navigate('/onboarding'), 800);
      } else {
        throw new Error('deleteSpace returned false');
      }
    } catch (err) {
      console.error('[SpaceMembersCard] Delete failed:', err);
      toast.error(t('partnerInfo.deleteError', { defaultValue: 'Could not delete the space. Try again.' }));
    } finally {
      setDeleteLoading(false);
    }
  };

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
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {renameMode ? (
            // Phase 3-4: inline rename. Owner-gated below; this branch
            // only mounts when the user clicked the pencil.
            <div className="flex items-center gap-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                disabled={renameSaving}
                className="h-9 text-base font-semibold"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSave();
                  if (e.key === 'Escape') { setRenameMode(false); setRenameValue(displayedTitle); }
                }}
                aria-label={t('partnerInfo.renameInputLabel', { defaultValue: 'Space name' })}
              />
              <Button size="icon" className="h-8 w-8" onClick={handleRenameSave} disabled={renameSaving}>
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setRenameMode(false); setRenameValue(displayedTitle); }} disabled={renameSaving}>
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground truncate">
                {displayedTitle}
              </h3>
              {isOwner && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setRenameMode(true)}
                  aria-label={t('partnerInfo.rename', { defaultValue: 'Rename space' })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('partnerInfo.memberCount', '{{count}}/{{max}} members', { count: memberCount, max: maxMembers })}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs flex-shrink-0">
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

      {/* Leave / Delete Space (Phase 3-4: explicit Delete added) */}
      <div className="border-t border-border/30 pt-4 space-y-3">
        <Label className="text-sm font-medium text-destructive">{t('partnerInfo.dangerZone')}</Label>
        <div className="flex flex-wrap gap-2">
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
                  <p>{t('partnerInfo.unlinkConfirmDesc1', { spaceName: displayedTitle })}</p>
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

          {/* Phase 3-4: Delete Space — owner only, destructive for ALL members.
              Distinct from Leave: Leave only removes self; Delete tears down
              the entire space + cascades. Backed by SpaceProvider.deleteSpace
              which uses the olive-space-manage edge function. */}
          {isOwner && currentSpace?.id && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10" disabled={deleteLoading}>
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  {deleteLoading
                    ? t('partnerInfo.deleting', { defaultValue: 'Deleting…' })
                    : t('partnerInfo.deleteSpace', { defaultValue: 'Delete space' })}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    {t('partnerInfo.deleteSpaceConfirmTitle', { defaultValue: 'Delete this space?' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <p>
                      {t('partnerInfo.deleteSpaceConfirmDesc1', {
                        defaultValue: '"{{spaceName}}" and every shared note, list, expense, and member of it will be removed for everyone — not just you.',
                        spaceName: displayedTitle,
                      })}
                    </p>
                    <p className="font-medium">
                      {t('partnerInfo.deleteSpaceConfirmDesc2', { defaultValue: 'This cannot be undone.' })}
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('partnerInfo.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteSpace} className="bg-destructive hover:bg-destructive/90" disabled={deleteLoading}>
                    {t('partnerInfo.yesDeleteSpace', { defaultValue: 'Yes, delete space' })}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </Card>
  );
};

// Keep old export for backward compat
export const PartnerInfo = SpaceMembersCard;
