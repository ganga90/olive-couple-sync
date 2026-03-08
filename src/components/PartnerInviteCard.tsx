import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, X, Share2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { supabase } from "@/lib/supabaseClient";

const DISMISSED_KEY = "olive_partner_invite_dismissed";

export const PartnerInviteCard = () => {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  const { currentCouple, partner } = useSupabaseCouple();
  const INVITE_SENT_KEY = "olive_partner_invite_sent";
  const [dismissed, setDismissed] = useState(() => 
    localStorage.getItem(DISMISSED_KEY) === "true" || localStorage.getItem(INVITE_SENT_KEY) === "true"
  );
  const [partnerName, setPartnerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  // Don't show if dismissed, if partner already exists, or no couple
  if (dismissed || partner || !currentCouple) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  const handleInvite = async () => {
    if (!partnerName.trim()) return;
    setLoading(true);
    try {
      // Update couple with partner name
      const { error: updateError } = await supabase
        .from("clerk_couples")
        .update({
          partner_name: partnerName.trim(),
          title: `${currentCouple.you_name || "Me"} & ${partnerName.trim()}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentCouple.id);

      if (updateError) throw updateError;

      // Create invite
      const { data: inviteData, error } = await supabase.rpc("create_invite", {
        p_couple_id: currentCouple.id,
      });

      if (!error && inviteData?.token) {
        const link = `${window.location.origin}/accept-invite?token=${inviteData.token}`;
        setInviteUrl(link);
        localStorage.setItem(INVITE_SENT_KEY, "true");

        if (navigator.share) {
          try {
            await navigator.share({
              title: "Join me on Olive",
              text: `${currentCouple.you_name || "I"} invited you to share an Olive space! 🫒`,
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
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("partnerInvite.title", { defaultValue: "Better together" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("partnerInvite.subtitle", { defaultValue: "Invite your partner to share lists, tasks & calendars." })}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          value={partnerName}
          onChange={(e) => setPartnerName(e.target.value)}
          placeholder={t("partnerInvite.placeholder", { defaultValue: "Partner's name" })}
          className="h-10 text-sm"
        />
        <Button onClick={handleInvite} disabled={!partnerName.trim() || loading} size="sm" className="h-10 px-4">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
        </Button>
      </div>
    </Card>
  );
};
