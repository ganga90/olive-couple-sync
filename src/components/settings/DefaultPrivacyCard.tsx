import React from "react";
import { useTranslation } from "react-i18next";
import { Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDefaultPrivacy, type DefaultPrivacy } from "@/hooks/useDefaultPrivacy";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";

const PrivacyOption = ({
  value,
  selected,
  icon: Icon,
  title,
  description,
  onClick,
  color,
}: {
  value: DefaultPrivacy;
  selected: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  color: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex-1 flex flex-col items-start gap-2 p-4 rounded-2xl border-2 transition-all duration-200 text-left min-h-[44px]",
      selected
        ? "border-primary bg-primary/5 shadow-sm"
        : "border-border bg-card/50 hover:border-muted-foreground/30"
    )}
  >
    <div className={cn("icon-squircle w-9 h-9", color)}>
      <Icon className="h-4 w-4" />
    </div>
    <div>
      <p className={cn("font-semibold text-sm", selected ? "text-primary" : "text-foreground")}>{title}</p>
      <p className="text-xs text-muted-foreground leading-tight mt-0.5">{description}</p>
    </div>
    {selected && (
      <div className="w-2 h-2 rounded-full bg-primary ml-auto self-end" />
    )}
  </button>
);

export const DefaultPrivacyCard: React.FC = () => {
  const { t } = useTranslation("profile");
  const { currentCouple } = useSupabaseCouple();
  const { defaultPrivacy, saving, saveDefaultPrivacy } = useDefaultPrivacy();

  if (!currentCouple) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground leading-relaxed">
        {t("defaultPrivacy.description", "Choose the default visibility for new tasks and lists you create.")}
      </p>
      <div className="flex gap-3">
        <PrivacyOption
          value="private"
          selected={defaultPrivacy === "private"}
          icon={Lock}
          title={t("defaultPrivacy.private", "Private")}
          description={t("defaultPrivacy.privateDesc", "Only you can see it")}
          onClick={() => saveDefaultPrivacy("private")}
          color="bg-muted"
        />
        <PrivacyOption
          value="shared"
          selected={defaultPrivacy === "shared"}
          icon={Users}
          title={t("defaultPrivacy.shared", "Shared")}
          description={t("defaultPrivacy.sharedDesc", "You and your partner")}
          onClick={() => saveDefaultPrivacy("shared")}
          color="bg-primary/10"
        />
      </div>
      {saving && (
        <p className="text-xs text-muted-foreground text-center animate-pulse">
          {t("defaultPrivacy.saving", "Saving...")}
        </p>
      )}
    </div>
  );
};
