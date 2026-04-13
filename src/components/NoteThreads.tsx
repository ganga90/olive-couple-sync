/**
 * NoteThreads — Threaded comments on a note.
 *
 * Shows existing comments with author avatars and timestamps,
 * plus an input to add new comments. Supports @mentions in text.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { MessageCircle, Send, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUser } from "@clerk/clerk-react";
import {
  useCollaboration,
  NoteThread,
} from "@/hooks/useCollaboration";
import { formatDistanceToNow } from "date-fns";

interface NoteThreadsProps {
  noteId: string;
  className?: string;
  /** If true, shows inline collapsed (click to expand) */
  collapsible?: boolean;
}

export const NoteThreads: React.FC<NoteThreadsProps> = ({
  noteId,
  className,
  collapsible = false,
}) => {
  const { user } = useUser();
  const { addThread, listThreads, deleteThread } = useCollaboration();
  const [threads, setThreads] = useState<NoteThread[]>([]);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(!collapsible);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    const data = await listThreads(noteId);
    setThreads(data);
    setLoading(false);
  }, [noteId, listThreads]);

  useEffect(() => {
    if (expanded) {
      fetchThreads();
    }
  }, [expanded, fetchThreads]);

  const handleSend = async () => {
    const text = newComment.trim();
    if (!text || sending) return;

    setSending(true);
    const thread = await addThread(noteId, text);
    if (thread) {
      setThreads((prev) => [...prev, thread]);
      setNewComment("");
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleDelete = async (threadId: string) => {
    const success = await deleteThread(threadId);
    if (success) {
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    }
  };

  const threadCount = threads.length;

  // Collapsed view: just show count
  if (collapsible && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          "hover:text-foreground transition-colors",
          className
        )}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {threadCount > 0 ? (
          <span>
            {threadCount} comment{threadCount !== 1 ? "s" : ""}
          </span>
        ) : (
          <span>Add comment</span>
        )}
      </button>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Comments{threadCount > 0 ? ` (${threadCount})` : ""}
        </span>
        {collapsible && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            Collapse
          </button>
        )}
      </div>

      {/* Thread list */}
      {loading && threads.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">Loading...</div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isOwn={thread.author_id === user?.id}
              onDelete={() => handleDelete(thread.id)}
            />
          ))}
        </div>
      )}

      {/* New comment input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Write a comment... Use @name to mention"
          className="text-sm h-9"
          maxLength={2000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!newComment.trim() || sending}
          className="h-9 px-3"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

// ─── Individual Thread Item ─────────────────────────────────────

const ThreadItem: React.FC<{
  thread: NoteThread;
  isOwn: boolean;
  onDelete: () => void;
}> = ({ thread, isOwn, onDelete }) => {
  const timeAgo = formatDistanceToNow(new Date(thread.created_at), {
    addSuffix: true,
  });

  // Render @mentions as highlighted text
  const renderBody = (text: string) => {
    const parts = text.split(/(@[A-Za-z0-9\s._-]+?)(?=\s|$|[,.!?;:])/g);
    return parts.map((part, i) =>
      part.startsWith("@") ? (
        <span key={i} className="text-primary font-medium">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  return (
    <div
      className={cn(
        "group flex gap-2 py-2 px-3 rounded-lg",
        "bg-muted/30 hover:bg-muted/50 transition-colors"
      )}
    >
      {/* Avatar initial */}
      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">
        {(thread.author_display_name || "?")[0].toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {thread.author_display_name || "Unknown"}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {timeAgo}
          </span>
        </div>
        <p className="text-sm text-foreground/90 mt-0.5 break-words">
          {renderBody(thread.body)}
        </p>
      </div>

      {/* Actions (own threads only) */}
      {isOwn && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded">
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default NoteThreads;
