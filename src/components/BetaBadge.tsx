import React from "react";
import { cn } from "@/lib/utils";

interface BetaBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export const BetaBadge: React.FC<BetaBadgeProps> = ({ size = "sm", className }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-bold uppercase tracking-wider",
        "bg-primary/15 text-primary border border-primary/30",
        size === "sm" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5",
        className
      )}
    >
      Beta
    </span>
  );
};
