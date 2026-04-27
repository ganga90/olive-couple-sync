import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, X, Share2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { supabase } from "@/lib/supabaseClient";

const DISMISSED_KEY = "olive_partner_invite_dismissed";

export const PartnerInviteCard = () => {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  const { currentCouple, members } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  // Phase 3-2: removed auto-dismiss after the first INVITE_SENT_KEY trigger.
  // The card now persists across inviting members 2 → max_members and only
  // hides when the user explicitly dismisses it OR the space is at capacity.
  // The legacy localStorage key is intentionally NOT read so users who had
  // dismissed after their first invite see the card again post-deploy and
  // can invite a 3rd / 4th / 5th member.
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY) === "true",
  );
  const [partnerName, setPartnerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  const otherMembers = members.filter(m => m.user_id !== user?.id);
  const totalMembers = members.length || 1;
  const maxMembers = currentSpace?.max_members ?? 10;
  const seatsLeft = Math.max(0, maxMembers - totalMembers);

  // Hide when: explicitly dismissed, no space context at all, or no
  // remaining seats. Continues to render between member 2 and the cap.
  if (dismissed) return null;
  if (!currentCouple && !currentSpace) return null;
  if (seatsLeft === 0) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  const handleInvite = async () => {
    if (!partnerName.trim()) return;
    setLoading(true);
    try {
      // Phase 3-2: only stamp clerk_couples.partner_name on the FIRST
      // invite (when no other members yet AND we're in a couple-type
      // space). For subsequent invites we preserve the existing partner
      // name; for non-couple spaces (no clerk_couples row at all) we
      // skip the update entirely.
      if (isFirstInvite && currentCouple) {
        const { error: updateError } = await supabase
          .from("clerk_couples")
          .update({
            partner_name: partnerName.trim(),
            title: `${currentCouple.you_name || "Me"} & ${partnerName.trim()}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", currentCouple.id);

        if (updateError) throw updateError;
      }

      // Create invite — works for couple-type AND non-couple spaces
      // because the RPC keys off the space ID, not couple-only state.
      const inviteScopeId = currentSpace?.id || currentCouple?.id;
      if (!inviteScopeId) {
        throw new Error("No space context for invite");
      }
      const { data: inviteData, error } = await supabase.rpc("create_invite", {
        p_couple_id: inviteScopeId,
      });

      if (!error && inviteData?.token) {
        const link = `${window.location.origin}/accept-invite?token=${inviteData.token}`;
        setInviteUrl(link);
        // Phase 3-2: do NOT set INVITE_SENT_KEY anymore — we want the
        // card to remain available for inviting subsequent members up to
        // max_members. The user can still dismiss explicitly via the X.

        if (navigator.share) {
          try {
            // Use the inviter's display name from their profile when we
            // have it, else fall back to the legacy couple field, else "I".
            const inviterName = currentCouple?.you_name || (user as any)?.firstName || "I";
            await navigator.share({
              title: "Join me on Olive",
              text: `${inviterName} invited you to share an Olive space! 🫒`,
              url: link,
            });
          } catch {}
        }
      }
    } catch (e) {
      console.error("Failed to create invite:", e);
      toast.error(t("partnerInvite.error", { defaultValue: "Couldn't create invite. Try again." }));
    } finally {
      setLoading(false);
    }
  };

  if (inviteUrl) {
    return (
      <Card className="p-4 bg-primary/5 border-primary/20 space-y-3">
        <div className="flex items-center gap-2">
          <Check className="w-5 h-5 text-primary" />
          <p className="text-sm font-medium text-foreground">
            {t("partnerInvite.sent", { defaultValue: "Invite link created!" })}
          </p>
        </div>
        <div className="flex gap-2">
          <input value={inviteUrl} readOnly className="flex-1 text-xs bg-background p-2 rounded border truncate" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(inviteUrl);
              toast.success(t("partnerInvite.copied", { defaultValue: "Copied!" }));
            }}
          >
            {t("partnerInvite.copy", { defaultValue: "Copy" })}
          </Button>
        </div>
        <button onClick={handleDismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {t("partnerInvite.dismiss", { defaultValue: "Dismiss" })}
        </button>
      </Card>
    );
  }

  // Phase 3-2: the card has two faces.
  //  • First-invite (otherMembers.length === 0): warm onboarding copy
  //    ("Better together / invite your partner to share lists...").
  //  • Subsequent invites: short, neutral copy with a capacity hint
  //    ("Invite someone to {space.name}. {seatsLeft} of {max} seats left.").
  const isFirstInvite = otherMembers.length === 0;
  const spaceName = currentSpace?.name?.trim() || t("partnerInvite.defaultSpaceName", { defaultValue: "your space" });

  const titleText = isFirstInvite
    ? t("partnerInvite.title", { defaultValue: "Better together" })
    : t("partnerInvite.titleMore", { defaultValue: "Invite someone to {{name}}", name: spaceName });
  const subtitleText = isFirstInvite
    ? t("partnerInvite.subtitle", { defaultValue: "Invite your partner to share lists, tasks & calendars." })
    : t("partnerInvite.subtitleMore", {
        defaultValue: "{{count}} seat left to share lists, tasks & calendars.",
        defaultValue_plural: "{{count}} seats left to share lists, tasks & calendars.",
        count: seatsLeft,
      });
  const placeholderText = isFirstInvite
    ? t("partnerInvite.placeholder", { defaultValue: "Partner's name" })
    : t("partnerInvite.placeholderMore", { defaultValue: "Member's name" });

  return (
    <Card className="p-4 bg-card/80 border-border/50 shadow-card space-y-3 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Users className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {titleText}
          </p>
          <p className="text-xs text-muted-foreground">
            {subtitleText}
          </p>
        </div>
        {!isFirstInvite && (
          <div className="text-[10px] font-medium text-muted-foreground/80 px-2 py-1 rounded-full bg-muted/40 flex-shrink-0">
            {totalMembers}/{maxMembers}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={partnerName}
          onChange={(e) => setPartnerName(e.target.value)}
          placeholder={placeholderText}
          className="h-10 text-sm"
        />
        <Button onClick={handleInvite} disabled={!partnerName.trim() || loading} size="sm" className="h-10 px-4">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
        </Button>
      </div>
    </Card>
  );
};
