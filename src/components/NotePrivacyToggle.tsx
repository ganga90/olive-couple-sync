import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User, Users, Lock, Globe } from "lucide-react";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { toast } from "sonner";
import type { Note } from "@/types/note";

interface NotePrivacyToggleProps {
  note: Note;
  size?: "sm" | "default";
  variant?: "ghost" | "outline" | "default";
}

export const NotePrivacyToggle: React.FC<NotePrivacyToggleProps> = ({
  note,
  size = "sm",
  variant = "ghost"
}) => {
  const { currentCouple, members } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  const { updateNote } = useSupabaseNotesContext();
  const [isUpdating, setIsUpdating] = useState(false);

  // Determine if note is currently private or shared
  const isPrivate = !note.isShared;
  // Phase 3-3: also enable the toggle for non-couple Spaces — was
  // gated on `currentCouple` only, hiding the affordance entirely
  // for family / business / custom spaces.
  const canToggle = !!currentCouple || !!currentSpace;

  // Member count for the badge / popover audience reveal.
  const memberCount = members.length || (currentSpace?.member_count ?? 0);
  const sharedMemberNames = useMemo(
    () => members.map((m) => m.display_name).filter(Boolean),
    [members],
  );
  const isMultiMember = memberCount > 2;

  const handleTogglePrivacy = async (makeShared: boolean) => {
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      // Phase 1A added space_id-aware writes to useSupabaseNotes; pass
      // both fields so the canonical scope is set whichever shape the
      // provider prefers. spaceId/coupleId for couple-type spaces are
      // the same UUID via the 1:1 bridge.
      const scopeId = currentSpace?.id || currentCouple?.id;
      const updates = {
        spaceId: makeShared ? scopeId : null,
        coupleId: makeShared ? currentCouple?.id : null,
        isShared: makeShared,
      };

      await updateNote(note.id, updates);

      toast.success(makeShared ? "Note shared with your space" : "Note made private");
    } catch (error) {
      console.error("Error toggling note privacy:", error);
      toast.error("Failed to update note privacy");
    } finally {
      setIsUpdating(false);
    }
  };

  if (!canToggle) {
    // No space context — display read-only state.
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <User className="h-3 w-3" />
        Private
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isUpdating}
          className="flex items-center gap-1 text-xs h-auto py-1 px-2"
        >
          {isPrivate ? (
            <>
              <Lock className="h-3 w-3" />
              Private
            </>
          ) : (
            <>
              <Globe className="h-3 w-3" />
              {isMultiMember ? `Shared · ${memberCount}` : "Shared"}
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Note Visibility
          </div>

          <Button
            variant={isPrivate ? "default" : "ghost"}
            size="sm"
            onClick={() => handleTogglePrivacy(false)}
            disabled={isUpdating || isPrivate}
            className="w-full justify-start text-xs"
          >
            <User className="h-3 w-3 mr-2" />
            Private (Only you)
          </Button>

          <Button
            variant={!isPrivate ? "default" : "ghost"}
            size="sm"
            onClick={() => handleTogglePrivacy(true)}
            disabled={isUpdating || !isPrivate}
            className="w-full justify-start text-xs"
          >
            <Users className="h-3 w-3 mr-2" />
            Shared with space
          </Button>

          {/* Phase 3-3: surface the audience when the note is shared so
              the user knows exactly who can read it. */}
          {!isPrivate && sharedMemberNames.length > 0 && (
            <>
              <div className="h-px bg-border my-2" />
              <div className="px-1 space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Visible to
                </p>
                <p className="text-[11px] text-foreground/80 leading-snug">
                  {sharedMemberNames.join(", ")}
                </p>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};