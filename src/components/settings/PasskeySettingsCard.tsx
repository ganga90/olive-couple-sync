import { useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2, ShieldCheck, Check } from "lucide-react";
import { toast } from "sonner";

export const PasskeySettingsCard: React.FC = () => {
  const { t } = useTranslation("auth");
  const { user } = useUser();
  const [creating, setCreating] = useState(false);

  const passkeys = (user as any)?.passkeys ?? [];
  const hasPasskey = passkeys.length > 0;

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    try {
      await (user as any).createPasskey();
      toast.success(
        t("passkey.created", "Passkey created! You can now sign in with biometrics."),
        { icon: "🔑" }
      );
    } catch (err: any) {
      console.error("[PasskeySettings] Error creating passkey:", err);
      if (err?.name === "NotAllowedError") {
        toast(t("passkey.cancelled", "Passkey creation was cancelled."), { icon: "ℹ️" });
      } else {
        const clerkError = err?.errors?.[0];
        toast.error(
          clerkError?.longMessage || t("passkey.error", "Failed to create passkey. Try again later.")
        );
      }
    } finally {
      setCreating(false);
    }
  };

  if (hasPasskey) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-[hsl(var(--success))]" />
        <span>{t("passkey.alreadyRegistered", "Passkey registered — you can sign in with biometrics.")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted/50 p-3 space-y-2">
        {[
          t("passkey.benefit1", "Sign in with Face ID or fingerprint"),
          t("passkey.benefit2", "No codes to type or remember"),
          t("passkey.benefit3", "More secure than passwords"),
        ].map((benefit, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span className="text-foreground">{benefit}</span>
          </div>
        ))}
      </div>

      <Button
        onClick={handleCreate}
        disabled={creating}
        size="sm"
        className="w-full"
      >
        {creating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("passkey.creating", "Creating passkey...")}
          </>
        ) : (
          <>
            <Fingerprint className="mr-2 h-4 w-4" />
            {t("passkey.createButton", "Create passkey")}
          </>
        )}
      </Button>
    </div>
  );
};

export default PasskeySettingsCard;
