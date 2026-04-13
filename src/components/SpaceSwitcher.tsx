/**
 * SpaceSwitcher — Dropdown to switch between spaces.
 *
 * Shows the current space name + icon, and a dropdown of all spaces.
 * Includes a "Create new space" action at the bottom.
 *
 * Used in both DesktopSidebar (below logo) and MobileHeader.
 */
import React, { useState } from "react";
import { Check, ChevronDown, Plus, Users, Home, Briefcase, Heart, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSpace, Space, SpaceType } from "@/providers/SpaceProvider";

const SPACE_TYPE_ICONS: Record<SpaceType, React.ReactNode> = {
  couple: <Heart className="h-4 w-4 text-rose-500" />,
  family: <Home className="h-4 w-4 text-amber-500" />,
  household: <Home className="h-4 w-4 text-emerald-500" />,
  business: <Briefcase className="h-4 w-4 text-blue-500" />,
  custom: <Settings2 className="h-4 w-4 text-violet-500" />,
};

const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  couple: "Couple",
  family: "Family",
  household: "Household",
  business: "Business",
  custom: "Space",
};

function SpaceIcon({ space, className }: { space: Space; className?: string }) {
  if (space.icon) {
    return <span className={cn("text-base", className)}>{space.icon}</span>;
  }
  return <>{SPACE_TYPE_ICONS[space.type] || SPACE_TYPE_ICONS.custom}</>;
}

interface SpaceSwitcherProps {
  onCreateSpace?: () => void;
  compact?: boolean;
  className?: string;
}

export const SpaceSwitcher: React.FC<SpaceSwitcherProps> = ({
  onCreateSpace,
  compact = false,
  className,
}) => {
  const { spaces, currentSpace, switchSpace, loading, hasSpaces } = useSpace();

  if (loading || !hasSpaces) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-between gap-2 font-medium",
            compact ? "h-9 px-3 text-sm" : "h-11 px-4 text-base",
            "hover:bg-sidebar-accent/50 rounded-xl",
            className
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {currentSpace && <SpaceIcon space={currentSpace} />}
            <span className="truncate">
              {currentSpace?.name || "Select Space"}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-[240px]"
        align="start"
        side="bottom"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Your Spaces
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {spaces.map((space) => (
            <DropdownMenuItem
              key={space.id}
              onClick={() => switchSpace(space)}
              className={cn(
                "flex items-center gap-2.5 py-2.5 cursor-pointer",
                currentSpace?.id === space.id && "bg-accent"
              )}
            >
              <SpaceIcon space={space} />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-sm">
                  {space.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {SPACE_TYPE_LABELS[space.type]}
                  {space.member_count ? ` · ${space.member_count} member${space.member_count !== 1 ? "s" : ""}` : ""}
                </div>
              </div>
              {currentSpace?.id === space.id && (
                <Check className="h-4 w-4 text-primary shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        {onCreateSpace && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onCreateSpace}
              className="flex items-center gap-2.5 py-2.5 cursor-pointer text-primary"
            >
              <Plus className="h-4 w-4" />
              <span className="font-medium text-sm">Create new space</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default SpaceSwitcher;
