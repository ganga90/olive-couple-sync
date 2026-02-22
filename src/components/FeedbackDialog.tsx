import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabaseClient";

const FEEDBACK_CATEGORIES = ["bug", "feature", "improvement", "other"] as const;

export const FeedbackDialog: React.FC<{ variant?: "fab" | "inline" }> = ({ variant = "fab" }) => {
  const { t } = useTranslation("common");
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("improvement");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isAuthenticated } = useAuth();

  // Only show the floating feedback button to authenticated users
  if (!isAuthenticated && variant === "fab") return null;

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error(t("feedback.messageRequired", "Please enter your feedback"));
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.functions.invoke("send-feedback", {
        body: {
          category,
          message: message.trim(),
          contactEmail: contactEmail.trim() || (user?.primaryEmailAddress?.emailAddress ?? ""),
          userName: user?.fullName || user?.firstName || "Anonymous",
          userId: user?.id || "anonymous",
          page: window.location.pathname,
          userAgent: navigator.userAgent,
        },
      });

      if (error) throw error;

      toast.success(t("feedback.thankYou", "Thanks for your feedback! 💚"));
      setMessage("");
      setCategory("improvement");
      setContactEmail("");
      setOpen(false);
    } catch (err) {
      console.error("[Feedback] Error:", err);
      toast.error(t("feedback.error", "Failed to send feedback. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const feedbackForm = (
    <div className="space-y-4 p-1">
      {/* Category pills */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">{t("feedback.category", "Category")}</Label>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                category === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-transparent hover:border-border"
              )}
            >
              {t(`feedback.cat_${cat}`, cat.charAt(0).toUpperCase() + cat.slice(1))}
            </button>
          ))}
        </div>
      </div>

      {/* Message */}
      <div className="space-y-2">
        <Label htmlFor="feedback-message" className="text-sm font-medium">
          {t("feedback.messageLabel", "Your feedback")}
        </Label>
        <Textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("feedback.placeholder", "What's on your mind? Bugs, ideas, things you love...")}
          className="min-h-[120px] bg-background resize-none"
          maxLength={2000}
        />
      </div>

      {/* Contact email (optional, pre-filled if logged in) */}
      {!user && (
        <div className="space-y-2">
          <Label htmlFor="feedback-email" className="text-sm font-medium">
            {t("feedback.emailLabel", "Email (optional)")}
          </Label>
          <Input
            id="feedback-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={t("feedback.emailPlaceholder", "your@email.com")}
            className="bg-background text-base"
          />
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting || !message.trim()}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("feedback.sending", "Sending...")}
          </>
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            {t("feedback.send", "Send Feedback")}
          </>
        )}
      </Button>
    </div>
  );

  const triggerButton =
    variant === "fab" ? (
      <button
        className={cn(
          "fixed z-50 flex items-center gap-2 rounded-full shadow-lg transition-all",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          "px-4 py-3 text-sm font-medium",
          isMobile
            ? "bottom-[calc(90px+env(safe-area-inset-bottom)+8px)] right-4"
            : "bottom-6 right-6"
        )}
        aria-label={t("feedback.title", "Send Feedback")}
      >
        <MessageSquarePlus className="h-4 w-4" />
        <span className="hidden sm:inline">{t("feedback.title", "Feedback")}</span>
      </button>
    ) : null;

  const title = t("feedback.dialogTitle", "Share your feedback");
  const description = t(
    "feedback.dialogDescription",
    "Help us make Olive better. Your feedback goes directly to the team."
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
        <DrawerContent className="px-4 pb-8">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          {feedbackForm}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerButton}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {feedbackForm}
      </DialogContent>
    </Dialog>
  );
};
