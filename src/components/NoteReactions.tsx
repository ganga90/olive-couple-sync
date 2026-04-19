/**
 * NoteReactions — Emoji reaction bar for notes.
 *
 * Shows existing reactions as pills (emoji + count), with a "+" button
 * to add new reactions from a quick picker. Clicking an existing
 * reaction toggles it (add/remove).
 */
import React, { useState, useEffect, useCallback } from "react";
import { Plus, SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCollaboration, ReactionSummary } from "@/hooks/useCollaboration";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "💡", "✅"];

interface NoteReactionsProps {
  noteId: string;
  compact?: boolean;
  className?: string;
}

export const NoteReactions: React.FC<NoteReactionsProps> = ({
  noteId,
  compact = false,
  className,
}) => {
  const { toggleReaction, getReactions } = useCollaboration();
  const [reactions, setReactions] = useState<ReactionSummary>({});
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fetchReactions = useCallback(async () => {
    const data = await getReactions(noteId);
    setReactions(data);
  }, [noteId, getReactions]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  const handleToggle = async (emoji: string) => {
    setLoading(true);
    // Optimistic update
    setReactions((prev) => {
      const updated = { ...prev };
      if (updated[emoji]?.reacted_by_me) {
        updated[emoji] = {
          ...updated[emoji],
          count: updated[emoji].count - 1,
          reacted_by_me: false,
        };
        if (updated[emoji].count <= 0) delete updated[emoji];
      } else {
        if (updated[emoji]) {
          updated[emoji] = {
            ...updated[emoji],
            count: updated[emoji].count + 1,
            reacted_by_me: true,
          };
        } else {
          updated[emoji] = {
            count: 1,
            users: ["You"],
            user_ids: [],
            reacted_by_me: true,
          };
        }
      }
      return updated;
    });

    await toggleReaction(noteId, emoji);
    setPickerOpen(false);
    // Refresh to get accurate server state
    await fetchReactions();
    setLoading(false);
  };

  const reactionEntries = Object.entries(reactions);
  const hasReactions = reactionEntries.length > 0;

  if (!hasReactions && compact) {
    // In compact mode, only show the add button on hover (handled by parent)
    return (
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-full",
              "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              "transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100",
              className
            )}
            aria-label="Add reaction"
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" side="top" align="start">
          <div className="flex gap-1">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleToggle(emoji)}
                className="p-1.5 rounded-md hover:bg-muted text-lg leading-none transition-colors"
                disabled={loading}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {reactionEntries.map(([emoji, data]) => (
        <button
          key={emoji}
          onClick={() => handleToggle(emoji)}
          disabled={loading}
          title={data.users.join(", ")}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm",
            "border transition-all cursor-pointer",
            data.reacted_by_me
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-muted/50 border-muted hover:border-primary/20"
          )}
        >
          <span className="text-base leading-none">{emoji}</span>
          <span className="text-xs font-medium">{data.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center justify-center w-7 h-7 rounded-full",
              "border border-dashed border-muted-foreground/30",
              "text-muted-foreground hover:text-foreground hover:border-primary/30",
              "transition-all"
            )}
            aria-label="Add reaction"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" side="top" align="start">
          <div className="flex gap-1">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleToggle(emoji)}
                className={cn(
                  "p-1.5 rounded-md hover:bg-muted text-lg leading-none transition-colors",
                  reactions[emoji]?.reacted_by_me && "bg-primary/10"
                )}
                disabled={loading}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NoteReactions;
