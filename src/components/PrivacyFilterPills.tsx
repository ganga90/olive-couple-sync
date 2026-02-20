import React from "react";
import { useTranslation } from "react-i18next";
import { Lock, Users, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

export type PrivacyFilter = "all" | "private" | "shared";

interface PrivacyFilterPillsProps {
  value: PrivacyFilter;
  onChange: (v: PrivacyFilter) => void;
  hasShared?: boolean;
  className?: string;
}

const options: { value: PrivacyFilter; icon: React.ElementType; labelKey: string }[] = [
  { value: "all", icon: LayoutGrid, labelKey: "privacyFilter.all" },
  { value: "private", icon: Lock, labelKey: "privacyFilter.private" },
  { value: "shared", icon: Users, labelKey: "privacyFilter.shared" },
];

export const PrivacyFilterPills: React.FC<PrivacyFilterPillsProps> = ({
  value,
  onChange,
  hasShared = true,
  className,
}) => {
  const { t } = useTranslation("common");

  const visibleOptions = options.filter(o => o.value !== "shared" || hasShared);

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {visibleOptions.map(({ value: optVal, icon: Icon, labelKey }) => (
        <button
          key={optVal}
          type="button"
          onClick={() => onChange(optVal)}
          className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-all duration-200",
            "border border-transparent min-h-[44px] md:min-h-[32px]",
            value === optVal
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-card/60 text-muted-foreground hover:bg-card hover:border-border/50"
          )}
        >
          <Icon className="h-3 w-3" />
          {t(labelKey, optVal === "all" ? "All" : optVal === "private" ? "Private" : "Shared")}
        </button>
      ))}
    </div>
  );
};
