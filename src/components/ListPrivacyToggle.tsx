import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Lock, Users, UserPlus } from "lucide-react";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { toast } from "sonner";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

/**
 * ListPrivacyToggle
 * ==================
 * Clickable Private/Shared pill for the LIST HEADER on ListCategory.
 *
 * Previous bug: when the user had no couple, the pill rendered as a
 * plain (non-clickable) Badge, so users on the screenshot reported
 * "I can't tap Private to change it". Now the pill is ALWAYS an
 * interactive Popover trigger; the popover content adapts to the
 * user's state:
 *   - Has couple  → Private ⇄ Shared toggle (writes couple_id on the list)
 *   - No couple   → Shows a "Invite your partner" CTA that deep-links
 *                   to Home where PartnerInviteCard lives.
 *
 * Writes are delegated to the parent's `onToggle` callback so this
 * component doesn't spawn its own `useSupabaseLists` instance (which
 * duplicated the realtime subscription and triggered extra fetches).
 * Realtime sync to other space members happens via the parent hook's
 * `clerk_lists_changes` channel.
 */

interface ListPrivacyToggleProps {
  /** true = list has a couple_id (shared); false = couple_id null (private). */
  isShared: boolean;
  /**
   * Called when the user picks a new privacy state. Returns true on
   * success so the popover can close; false/undefined keeps it open.
   * Parent owns the Supabase update + toast.
   */
  onToggle: (makeShared: boolean) => Promise<boolean | void>;
  /** Disabled while an update is in flight. */
  disabled?: boolean;
}

export const ListPrivacyToggle: React.FC<ListPrivacyToggleProps> = ({
  isShared,
  onToggle,
  disabled = false,
}) => {
  const { t } = useTranslation(["lists", "common"]);
  const { currentCouple, members } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  const navigate = useLocalizedNavigate();
  const [isUpdating, setIsUpdating] = useState(false);
  const [open, setOpen] = useState(false);

  const hasCouple = !!currentCouple;
  // Phase 3-3: pill copy + popover header should reflect the actual
  // member count when the list is shared. For 2-person spaces this
  // matches the existing single "Shared" framing; for 3-10 spaces it
  // becomes "Shared · N" so the user understands the audience.
  const memberCount = members.length || (currentSpace?.member_count ?? 0);
  const sharedMemberNames = useMemo(
    () => members.map((m) => m.display_name).filter(Boolean),
    [members],
  );
  const isMultiMember = memberCount > 2;

  const handleSelect = async (makeShared: boolean) => {
    if (isUpdating) return;
    // No-op when clicking the active option.
    if (makeShared === isShared) {
      setOpen(false);
      return;
    }
    // Sharing requires a couple. Without one, route to the invite flow.
    if (makeShared && !hasCouple) {
      setOpen(false);
      navigate("/home");
      toast.info(
        t("listDetail.inviteFirstToast", {
          defaultValue: "Invite someone first, then share this list.",
        }),
      );
      return;
    }

    setIsUpdating(true);
    try {
      const ok = await onToggle(makeShared);
      if (ok !== false) setOpen(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleInvite = () => {
    setOpen(false);
    navigate("/home");
  };

  const triggerClass = isShared
    ? "h-auto py-0.5 px-2 text-xs bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20 flex-shrink-0 gap-1 rounded-full border-0 cursor-pointer"
    : "h-auto py-0.5 px-2 text-xs bg-muted text-muted-foreground hover:bg-muted/80 active:bg-muted flex-shrink-0 gap-1 rounded-full border-0 cursor-pointer";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || isUpdating}
          className={triggerClass}
          aria-label={t("listDetail.privacyToggle", {
            defaultValue: "Change list visibility",
          })}
        >
          {isShared ? (
            <>
              <Users className="h-3 w-3" />
              {isMultiMember
                ? `${t("lists:badges.shared", { defaultValue: "Shared" })} · ${memberCount}`
                : t("lists:badges.shared", { defaultValue: "Shared" })}
            </>
          ) : (
            <>
              <Lock className="h-3 w-3" />
              {t("lists:badges.private", { defaultValue: "Private" })}
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
            {t("listDetail.visibilityLabel", {
              defaultValue: "List visibility",
            })}
          </div>

          <Button
            variant={!isShared ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSelect(false)}
            disabled={isUpdating}
            className="w-full justify-start text-xs"
          >
            <Lock className="h-3 w-3 mr-2" />
            {t("listDetail.privateOption", {
              defaultValue: "Private (only you)",
            })}
          </Button>

          <Button
            variant={isShared ? "default" : "ghost"}
            size="sm"
            onClick={() => handleSelect(true)}
            disabled={isUpdating || (!hasCouple && isShared)}
            className="w-full justify-start text-xs"
          >
            <Users className="h-3 w-3 mr-2" />
            {t("listDetail.sharedOption", {
              defaultValue: "Shared with space",
            })}
          </Button>

          {/* Phase 3-3: when the list IS shared, show who's in the audience.
              Lets the user verify what "Shared" actually means in a 3-10
              member space (where the count alone is ambiguous). */}
          {isShared && sharedMemberNames.length > 0 && (
            <>
              <div className="h-px bg-border my-2" />
              <div className="px-1 space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("listDetail.visibleTo", {
                    defaultValue: "Visible to",
                  })}
                </p>
                <p className="text-[11px] text-foreground/80 leading-snug">
                  {sharedMemberNames.join(", ")}
                </p>
              </div>
            </>
          )}

          {!hasCouple && (
            <>
              <div className="h-px bg-border my-2" />
              <p className="text-[11px] text-muted-foreground px-1 leading-snug">
                {t("listDetail.needsPartnerDesc", {
                  defaultValue:
                    "Sharing needs someone to share with. Invite a partner or member first.",
                })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleInvite}
                disabled={isUpdating}
                className="w-full justify-start text-xs mt-1"
              >
                <UserPlus className="h-3 w-3 mr-2" />
                {t("listDetail.invitePartner", {
                  defaultValue: "Invite someone",
                })}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ListPrivacyToggle;
