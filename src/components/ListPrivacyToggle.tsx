import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Lock, Users } from "lucide-react";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseLists } from "@/hooks/useSupabaseLists";
import { toast } from "sonner";

/**
 * ListPrivacyToggle
 * ==================
 * Clickable Private/Shared pill for the LIST HEADER on ListCategory.
 *
 * Why a separate component from NotePrivacyToggle?
 *   - Different data source (clerk_lists vs clerk_notes) + different hook
 *     (useSupabaseLists.updateList vs useSupabaseNotes.updateNote).
 *   - Different badge visual (matches the header badge style used on the
 *     list-detail page, not the list-item row style).
 *
 * Why mirror NotePrivacyToggle's Popover structure?
 *   - UX consistency: tapping either the note or list pill surfaces the
 *     same Private / Shared choice affordance.
 *   - Keeps a single mental model for users: "this pill toggles who can
 *     see this thing."
 *
 * Failure-mode safety:
 *   - If the user has no couple, the pill is read-only (can't toggle to
 *     "Shared" with no one to share with). Renders as a plain badge,
 *     matching the pre-toggle behavior exactly.
 *   - The Supabase update is awaited; a toast confirms success or
 *     surfaces failure. The local `useSupabaseLists` cache already
 *     refreshes on update() so no extra re-render glue needed.
 */

interface ListPrivacyToggleProps {
  listId: string;
  /** true = list has a couple_id (shared); false = couple_id null (private). */
  isShared: boolean;
  /** Match the page header badge sizing. */
  size?: "sm" | "default";
}

export const ListPrivacyToggle: React.FC<ListPrivacyToggleProps> = ({
  listId,
  isShared,
  size = "sm",
}) => {
  const { t } = useTranslation(["lists", "common"]);
  const { currentCouple } = useSupabaseCouple();
  const { updateList } = useSupabaseLists(currentCouple?.id || null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [open, setOpen] = useState(false);

  // Can only toggle when the user is in a couple — the "shared" option
  // requires a couple_id to write. No couple → show read-only pill.
  const canToggle = !!currentCouple;

  const handleToggle = async (makeShared: boolean) => {
    // Idempotent: clicking the currently-active option is a no-op
    // (also guarded by `disabled` in the button, but belt-and-braces).
    if (isUpdating) return;
    if (makeShared === isShared) {
      setOpen(false);
      return;
    }

    setIsUpdating(true);
    try {
      const newCoupleId = makeShared && currentCouple?.id ? currentCouple.id : null;
      const result = await updateList(listId, { couple_id: newCoupleId });

      if (result) {
        toast.success(
          makeShared
            ? t("listDetail.listShared", "List shared with your space")
            : t("listDetail.listMadePrivate", "List is now private")
        );
        setOpen(false);
      } else {
        // updateList returns null on failure; show a toast so the user
        // knows the click did something (but didn't succeed).
        toast.error(t("common.errorGeneric", { ns: "common", defaultValue: "Something went wrong. Please try again." }));
      }
    } catch (err) {
      console.error("[ListPrivacyToggle] Update failed:", err);
      toast.error(t("common.errorGeneric", { ns: "common", defaultValue: "Something went wrong. Please try again." }));
    } finally {
      setIsUpdating(false);
    }
  };

  // No couple → read-only badge, identical to the pre-toggle render.
  if (!canToggle) {
    return isShared ? (
      <Badge variant="secondary" className="text-xs bg-primary/10 text-primary flex-shrink-0 gap-1">
        <Users className="h-3 w-3" />
        {t("lists:badges.shared", "Shared")}
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground flex-shrink-0 gap-1">
        <Lock className="h-3 w-3" />
        {t("lists:badges.private", "Private")}
      </Badge>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/*
          Render the trigger as a Button (not a raw badge) so it inherits
          proper focus-visible + active states + keyboard handling from
          shadcn. Visual size is matched to the header badge so the
          conversion looks identical to the previous static pill.
        */}
        <Button
          type="button"
          variant="ghost"
          size={size}
          disabled={isUpdating}
          // Match the badge padding/height exactly; `h-auto` lets the
          // content set the height so the header doesn't jump when the
          // toggle becomes interactive.
          className={
            isShared
              ? "h-auto py-0.5 px-2 text-xs bg-primary/10 text-primary hover:bg-primary/15 flex-shrink-0 gap-1 rounded-full border-0"
              : "h-auto py-0.5 px-2 text-xs bg-muted text-muted-foreground hover:bg-muted/80 flex-shrink-0 gap-1 rounded-full border-0"
          }
          aria-label={t("listDetail.privacyToggle", "Change list visibility")}
        >
          {isShared ? (
            <>
              <Users className="h-3 w-3" />
              {t("lists:badges.shared", "Shared")}
            </>
          ) : (
            <>
              <Lock className="h-3 w-3" />
              {t("lists:badges.private", "Private")}
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-52 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
            {t("listDetail.visibilityLabel", "List visibility")}
          </div>

          <Button
            variant={!isShared ? "default" : "ghost"}
            size="sm"
            onClick={() => handleToggle(false)}
            disabled={isUpdating || !isShared}
            className="w-full justify-start text-xs"
          >
            <Lock className="h-3 w-3 mr-2" />
            {t("listDetail.privateOption", "Private (only you)")}
          </Button>

          <Button
            variant={isShared ? "default" : "ghost"}
            size="sm"
            onClick={() => handleToggle(true)}
            disabled={isUpdating || isShared}
            className="w-full justify-start text-xs"
          >
            <Users className="h-3 w-3 mr-2" />
            {t("listDetail.sharedOption", "Shared with partner")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ListPrivacyToggle;
