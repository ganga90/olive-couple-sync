import { useState } from "react";
import { useSafeUser as useUser } from "@/hooks/useSafeClerk";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Fingerprint, Loader2, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const DISMISS_KEY = "olive_passkey_prompt_dismissed";

/**
 * Check whether the passkey prompt should be shown.
 * Returns true only if:
 *  - User has no passkeys registered
 *  - User hasn't permanently dismissed the prompt
 */
export function shouldPromptPasskey(user: any): boolean {
  if (!user) return false;
  // Check if user already has passkeys
  const passkeys = (user as any).passkeys;
  if (passkeys && passkeys.length > 0) return false;
  // Check localStorage dismissal
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (dismissed === user.id) return false;
  return true;
}

export function PasskeyPromptDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("auth");
  const { user } = useUser();
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);
    try {
      await (user as any).createPasskey();
      toast.success(t("passkey.created", "Passkey created! You can now sign in with biometrics."), { icon: "🔑" });
      onClose();
    } catch (err: any) {
      console.error("[PasskeyPrompt] Error creating passkey:", err);
      const clerkError = err?.errors?.[0];
      if (err?.name === "NotAllowedError") {
        // User cancelled the browser prompt
        toast(t("passkey.cancelled", "Passkey creation was cancelled. You can try again from Profile settings."), { icon: "ℹ️" });
      } else if (clerkError?.code === "passkey_not_supported") {
        toast.error(t("passkey.notSupported", "Passkeys are not supported on this device."));
      } else {
        toast.error(clerkError?.longMessage || t("passkey.error", "Failed to create passkey. Try again later."));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDismiss = () => {
    // Don't show again for this user
    if (user) {
      localStorage.setItem(DISMISS_KEY, user.id);
    }
    onClose();
  };

  const handleSkip = () => {
    // Skip for now (will show again next login)
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleSkip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Fingerprint className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-xl">
            {t("passkey.promptTitle", "Enable faster sign-in?")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t(
              "passkey.promptDescription",
              "Create a passkey to sign in instantly with Face ID, Touch ID, or your device PIN. No more codes or passwords."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {/* Benefits */}
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
            size="lg"
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

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground"
              onClick={handleSkip}
            >
              {t("passkey.later", "Maybe later")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground"
              onClick={handleDismiss}
            >
              {t("passkey.dontAsk", "Don't ask again")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
