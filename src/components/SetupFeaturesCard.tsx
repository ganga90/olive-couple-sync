import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Calendar, MessageCircle, ArrowRight } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

/**
 * Shows a setup prompt on Home for users who haven't completed
 * key integrations (WhatsApp, Calendar) after onboarding.
 * Only appears if onboarding IS completed but key features are not set up.
 */
export const SetupFeaturesCard = () => {
  const { t } = useTranslation("home");
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getLocalizedPath } = useLanguage();

  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem("olive_setup_features_dismissed") === "true"
  );
  const [features, setFeatures] = useState<{
    calendar: boolean;
    whatsapp: boolean;
  } | null>(null);

  useEffect(() => {
    if (!user?.id || dismissed) return;

    const checkFeatures = async () => {
      try {
        // Check calendar connection
        const { data: calConn } = await supabase
          .from("calendar_connections")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .limit(1);

        // Check WhatsApp linkage (linking_tokens used)
        const { data: waLink } = await supabase
          .from("linking_tokens")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

        const calConnected = (calConn && calConn.length > 0);
        const waConnected = (waLink && waLink.length > 0);

        // If both are set up, nothing to show
        if (calConnected && waConnected) {
          setFeatures(null);
        } else {
          setFeatures({ calendar: !calConnected, whatsapp: !waConnected });
        }
      } catch {
        setFeatures(null);
      }
    };

    checkFeatures();
  }, [user?.id, dismissed]);

  if (dismissed || !features) return null;

  // If all features are connected, don't show
  if (!features.calendar && !features.whatsapp) return null;

  const handleDismiss = () => {
    localStorage.setItem("olive_setup_features_dismissed", "true");
    setDismissed(true);
  };

  const featureItems = [
    ...(features.whatsapp
      ? [
          {
            icon: MessageCircle,
            label: t("setupFeatures.whatsapp", { defaultValue: "Connect WhatsApp" }),
            description: t("setupFeatures.whatsappDesc", {
              defaultValue: "Text Olive naturally from WhatsApp",
            }),
            action: () => navigate(getLocalizedPath("/profile")),
          },
        ]
      : []),
    ...(features.calendar
      ? [
          {
            icon: Calendar,
            label: t("setupFeatures.calendar", { defaultValue: "Sync Calendar" }),
            description: t("setupFeatures.calendarDesc", {
              defaultValue: "See your schedule alongside tasks",
            }),
            action: () => navigate(getLocalizedPath("/calendar")),
          },
        ]
      : []),
  ];

  return (
    <Card className="p-4 md:p-5 bg-gradient-to-br from-primary/5 via-card to-accent/5 border-primary/20 shadow-card space-y-3 relative overflow-hidden">
      {/* Subtle glow */}
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-2xl" />

      <div className="flex items-center gap-3 relative">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {t("setupFeatures.title", { defaultValue: "Unlock Olive's best features" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("setupFeatures.subtitle", {
              defaultValue: "A couple quick connections to supercharge your experience.",
            })}
          </p>
        </div>
      </div>

      <div className="space-y-2 relative">
        {featureItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              onClick={item.action}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl",
                "bg-background/60 hover:bg-background/90 border border-border/50",
                "transition-all duration-200 group text-left"
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-muted/80 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                <Icon className="w-4.5 h-4.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          );
        })}
      </div>

      <button
        onClick={handleDismiss}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center pt-1"
      >
        {t("setupFeatures.dismiss", { defaultValue: "Maybe later" })}
      </button>
    </Card>
  );
};
