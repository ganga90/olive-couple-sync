import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { User, Users, Lock, Globe } from "lucide-react";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
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
  const { currentCouple } = useSupabaseCouple();
  const { updateNote } = useSupabaseNotesContext();
  const [isUpdating, setIsUpdating] = useState(false);

  // Determine if note is currently private or shared
  const isPrivate = !note.isShared;
  const canToggle = !!currentCouple; // Can only toggle if user has a couple

  const handleTogglePrivacy = async (makeShared: boolean) => {
    if (isUpdating) return;
    
    setIsUpdating(true);
    try {
      // Update the note's coupleId field to toggle privacy
      // If makeShared is true, set coupleId to current couple's id
      // If makeShared is false, set coupleId to null (private)
      const updates = {
        coupleId: makeShared ? currentCouple?.id : null,
        isShared: makeShared
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
    // If no couple, just show current state without toggle functionality
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
              Shared
            </>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-48 p-2" align="start">
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
            Shared with couple
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};