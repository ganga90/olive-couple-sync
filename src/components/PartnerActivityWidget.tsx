import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, ArrowRight, UserPlus, ChevronDown } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/hooks/useDateLocale";
import { cn } from "@/lib/utils";
import type { Note } from "@/types/note";

interface PartnerActivityWidgetProps {
  notes: Note[];
}

// Phase 3-1: Lift the 2-member cap. Show recent shared activity from
// every other member of the current space (not just "the partner").
// Default to one collapsed row (the freshest update) so Home stays calm;
// a single tap reveals up to MAX_VISIBLE_ACTIVITIES recent rows.
// Deeper history lives on the Space Activity page.
const COLLAPSED_VISIBLE = 1;
const MAX_VISIBLE_ACTIVITIES = 5;

export const PartnerActivityWidget: React.FC<PartnerActivityWidgetProps> = ({ notes }) => {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { partner, currentCouple, members, getMemberName } = useSupabaseCouple();
  const { currentSpace } = useSpace();
  const { getLocalizedPath } = useLanguage();
  const dateLocale = useDateLocale();
  const [expanded, setExpanded] = useState(false);

  const partnerName = partner || t('common:common.partner');
  const userId = user?.id;

  // The widget renders when EITHER:
  //   (a) The user is in a couple-type space (legacy 2-person case), OR
  //   (b) The user is in a non-couple space with at least one other
  //       member (family / business / custom — Phase 3 unblocks them).
  // Both reduce to "current space has anyone besides me".
  const otherMembersCount = useMemo(() => {
    return members.filter(m => m.user_id !== userId).length;
  }, [members, userId]);

  const isMultiMember = otherMembersCount >= 2;

  // Get recent shared activity from any other member of the space.
  const partnerActivity = useMemo(() => {
    if (!userId || (!currentCouple && !currentSpace)) return [];

    // A note is "shared" if it has either couple_id (legacy) or space_id
    // (canonical). Filter to shared notes authored by someone other
    // than the current user.
    const sharedFromOthers = notes
      .filter(note => {
        const isShared = !!note.coupleId || (note as any).space_id != null || (note as any).isShared === true;
        if (!isShared) return false;
        if (!note.authorId || note.authorId === userId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      // Fetch a generous slice; the render layer enforces MAX_VISIBLE_ACTIVITIES.
      .slice(0, MAX_VISIBLE_ACTIVITIES * 2);

    return sharedFromOthers.map(note => {
      // Post-canonicalization (PR fix/task-owner-canonicalization +
      // migration 20260513032720), task_owner is always a user_id or
      // null — so a clean equality check is all we need. The old
      // triple-OR comparison was leaking the literal token 'you'.
      const isAssignedToYou = !!userId && note.task_owner === userId;

      // Resolve the author's display name from space members.
      const authorName = note.authorId ? getMemberName(note.authorId) : partnerName;

      return {
        id: note.id,
        summary: note.summary,
        createdAt: note.createdAt,
        isAssignedToYou,
        authorName: authorName === "You" ? partnerName : authorName,
        type: isAssignedToYou ? 'assigned' : 'added' as const
      };
    });
  }, [notes, userId, currentCouple, currentSpace, members, getMemberName, partnerName]);

  // Hide the widget when there is no space at all, or when the user is
  // alone in their current space (nothing to attribute).
  if (!currentSpace && !currentCouple) return null;
  if (otherMembersCount === 0) return null;

  // Section title: in a 2-person couple keep the warmer "{Partner}'s
  // recent activity" framing; in 3+ member spaces, use a neutral
  // "Recent activity" since multiple authors are surfaced.
  const sectionTitle = isMultiMember
    ? t('home:partnerActivity.titleMulti', { defaultValue: 'Recent activity' })
    : t('home:partnerActivity.title', { name: partnerName });
  const emptyText = isMultiMember
    ? t('home:partnerActivity.emptyMulti', { defaultValue: 'No recent activity from other members yet.' })
    : t('home:partnerActivity.empty', { name: partnerName });

  const handleActivityClick = (noteId: string) => {
    navigate(getLocalizedPath(`/notes/${noteId}`));
  };

  // Show empty state if no partner activity
  if (partnerActivity.length === 0) {
    return (
      <div className="animate-fade-up stagger-2">
        <div className="flex items-center gap-2 mb-2 px-1">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {sectionTitle}
          </span>
        </div>
        <div className="px-3 py-4 rounded-lg bg-muted/20 border border-border/30 text-center">
          <p className="text-xs text-muted-foreground italic">
            {emptyText}
          </p>
        </div>
      </div>
    );
  }

  const visibleCount = expanded ? MAX_VISIBLE_ACTIVITIES : COLLAPSED_VISIBLE;
  const cappedTotal = Math.min(partnerActivity.length, MAX_VISIBLE_ACTIVITIES);
  const visible = partnerActivity.slice(0, visibleCount);
  const hiddenCount = cappedTotal - visibleCount;
  const canExpand = partnerActivity.length > COLLAPSED_VISIBLE;

  return (
    <div className="animate-fade-up stagger-2 mt-6">
      {/* Section Header - proper spacing and visual hierarchy */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground tracking-wide">
            {sectionTitle}
          </span>
        </div>
        {canExpand && (
          <span className="text-[11px] text-muted-foreground/70">
            {expanded
              ? t('home:partnerActivity.showingCount', { count: visible.length, defaultValue: 'Showing {{count}}' })
              : t('home:partnerActivity.recentCount', { count: partnerActivity.length })}
          </span>
        )}
      </div>

      {/* Activity Cards. By default we render only COLLAPSED_VISIBLE (1)
          so Home stays calm — the rest reveal on tap. */}
      <div className="space-y-2">
        {visible.map((activity) => (
          <button
            key={activity.id}
            onClick={() => handleActivityClick(activity.id)}
            className={cn(
              "w-full text-left px-4 py-3.5 rounded-2xl",
              "bg-white/70 hover:bg-white",
              "border border-stone-100 hover:border-primary/20",
              "transition-all duration-200 group",
              "active:scale-[0.99]"
            )}
          >
            <div className="flex items-start gap-3">
              {/* Icon with larger touch target */}
              <div className={cn(
                "mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                "transition-colors duration-200",
                activity.isAssignedToYou
                  ? 'bg-accent/20 text-accent group-hover:bg-accent/30'
                  : 'bg-primary/10 text-primary group-hover:bg-primary/20'
              )}>
                {activity.isAssignedToYou
                  ? <UserPlus className="w-4 h-4" />
                  : <Users className="w-4 h-4" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground leading-tight">
                  {activity.isAssignedToYou ? (
                    <span>
                      <span className="font-semibold text-foreground">{activity.authorName}</span>
                      {' '}{t('home:partnerActivity.assignedYou')}
                    </span>
                  ) : (
                    <span>
                      <span className="font-semibold text-foreground">{activity.authorName}</span>
                      {' '}{t('home:partnerActivity.added')}
                    </span>
                  )}
                </p>
                <p className="text-sm font-medium text-foreground truncate mt-1 group-hover:text-primary transition-colors">
                  {activity.summary}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                  {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: dateLocale })}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary
                                     opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all mt-2
                                     group-hover:translate-x-0.5" />
            </div>
          </button>
        ))}
      </div>

      {/* See more / Show less — keeps the surface calm by default */}
      {canExpand && (
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            "mt-2.5 w-full inline-flex items-center justify-center gap-1.5",
            "py-2 px-3 rounded-full",
            "text-xs font-medium text-muted-foreground hover:text-foreground",
            "hover:bg-muted/40 transition-colors"
          )}
          aria-expanded={expanded}
        >
          <span>
            {expanded
              ? t('home:partnerActivity.showLess', { defaultValue: 'Show less' })
              : t('home:partnerActivity.seeMore', { count: hiddenCount, defaultValue: 'See {{count}} more' })}
          </span>
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        </button>
      )}
    </div>
  );
};
