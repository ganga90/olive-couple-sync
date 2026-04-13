/**
 * SpaceActivityFeed — Real-time activity feed for a space.
 *
 * Displays recent actions (notes created, tasks completed, reactions,
 * comments, member joins) in a chronological feed with actor avatars
 * and human-readable descriptions.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  MessageCircle,
  FileText,
  CheckCircle2,
  UserPlus,
  UserMinus,
  Heart,
  ListTodo,
  UserCheck,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCollaboration, ActivityEvent } from "@/hooks/useCollaboration";
import { useSpace } from "@/providers/SpaceProvider";
import { formatDistanceToNow } from "date-fns";

const ACTION_CONFIG: Record<
  string,
  { icon: React.ReactNode; verb: string; color: string }
> = {
  note_created: {
    icon: <FileText className="h-3.5 w-3.5" />,
    verb: "added a note",
    color: "text-blue-500",
  },
  note_completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    verb: "completed a task",
    color: "text-green-500",
  },
  note_assigned: {
    icon: <UserCheck className="h-3.5 w-3.5" />,
    verb: "assigned a task",
    color: "text-amber-500",
  },
  note_updated: {
    icon: <FileText className="h-3.5 w-3.5" />,
    verb: "updated a note",
    color: "text-slate-500",
  },
  thread_created: {
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    verb: "commented",
    color: "text-violet-500",
  },
  reaction_added: {
    icon: <Heart className="h-3.5 w-3.5" />,
    verb: "reacted",
    color: "text-rose-500",
  },
  reaction_removed: {
    icon: <Heart className="h-3.5 w-3.5" />,
    verb: "removed a reaction",
    color: "text-slate-400",
  },
  member_joined: {
    icon: <UserPlus className="h-3.5 w-3.5" />,
    verb: "joined the space",
    color: "text-emerald-500",
  },
  member_left: {
    icon: <UserMinus className="h-3.5 w-3.5" />,
    verb: "left the space",
    color: "text-slate-400",
  },
  list_created: {
    icon: <ListTodo className="h-3.5 w-3.5" />,
    verb: "created a list",
    color: "text-blue-500",
  },
  list_updated: {
    icon: <ListTodo className="h-3.5 w-3.5" />,
    verb: "updated a list",
    color: "text-slate-500",
  },
  mention_created: {
    icon: <MessageCircle className="h-3.5 w-3.5" />,
    verb: "mentioned someone",
    color: "text-primary",
  },
};

const DEFAULT_ACTION = {
  icon: <FileText className="h-3.5 w-3.5" />,
  verb: "did something",
  color: "text-muted-foreground",
};

interface SpaceActivityFeedProps {
  /** Override space ID (defaults to currentSpace) */
  spaceId?: string;
  /** Max items to show */
  limit?: number;
  /** Show refresh button */
  showRefresh?: boolean;
  className?: string;
}

export const SpaceActivityFeed: React.FC<SpaceActivityFeedProps> = ({
  spaceId: propSpaceId,
  limit = 20,
  showRefresh = true,
  className,
}) => {
  const { currentSpace } = useSpace();
  const { getActivityFeed } = useCollaboration();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const spaceId = propSpaceId || currentSpace?.id;

  const fetchFeed = useCallback(async () => {
    if (!spaceId) {
      setActivities([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const data = await getActivityFeed(spaceId, { limit });
    setActivities(data);
    setLoading(false);
  }, [spaceId, limit, getActivityFeed]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  if (!spaceId) return null;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Activity
        </h3>
        {showRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchFeed}
            disabled={loading}
            className="h-7 px-2"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
          </Button>
        )}
      </div>

      {/* Feed */}
      {loading && activities.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Loading activity...
        </div>
      ) : activities.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No activity yet. Start collaborating!
        </div>
      ) : (
        <div className="space-y-1">
          {activities.map((event) => (
            <ActivityItem key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Individual Activity Item ───────────────────────────────────

const ActivityItem: React.FC<{ event: ActivityEvent }> = ({ event }) => {
  const config = ACTION_CONFIG[event.action] || DEFAULT_ACTION;
  const timeAgo = formatDistanceToNow(new Date(event.created_at), {
    addSuffix: true,
  });

  // Build descriptive text based on action + metadata
  const getDescription = () => {
    const meta = event.metadata || {};
    const preview = meta.preview ? `: "${meta.preview}"` : "";

    switch (event.action) {
      case "reaction_added":
        return `reacted ${meta.emoji || ""} to a note`;
      case "note_assigned":
        return `assigned a task to ${meta.assigned_to || "someone"}${preview}`;
      case "thread_created":
        return `commented${preview}`;
      default:
        return `${config.verb}${preview}`;
    }
  };

  return (
    <div className="flex items-start gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors">
      {/* Icon */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          "bg-muted/50",
          config.color
        )}
      >
        {config.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">
            {event.actor_display_name || "Someone"}
          </span>{" "}
          <span className="text-muted-foreground">{getDescription()}</span>
        </p>
        <span className="text-xs text-muted-foreground">{timeAgo}</span>
      </div>
    </div>
  );
};

export default SpaceActivityFeed;
