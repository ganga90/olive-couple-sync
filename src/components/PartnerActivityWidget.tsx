import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Users, ArrowRight, UserPlus } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { formatDistanceToNow } from "date-fns";
import type { Note } from "@/types/note";

interface PartnerActivityWidgetProps {
  notes: Note[];
}

export const PartnerActivityWidget: React.FC<PartnerActivityWidgetProps> = ({ notes }) => {
  const { t } = useTranslation(['home', 'common']);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { partner, currentCouple } = useSupabaseCouple();
  const { getLocalizedPath } = useLanguage();
  
  const partnerName = partner || t('common:common.partner');
  const userId = user?.id;

  // Get recent partner activity from shared notes only
  const partnerActivity = useMemo(() => {
    if (!userId || !currentCouple) return [];
    
    // Filter for shared notes (with coupleId) added by partner (not by current user)
    // Use authorId (raw user ID) for filtering, not addedBy (display name)
    const partnerNotes = notes
      .filter(note => {
        // Must be a shared note (has coupleId)
        if (!note.coupleId) return false;
        // Must be added by someone other than current user (partner)
        // Use authorId for accurate comparison
        if (note.authorId === userId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3); // Get last 3 activities
    
    return partnerNotes.map(note => {
      // Determine if it was assigned to the current user
      // task_owner could be 'you', the user's name, or their ID
      const youName = currentCouple?.you_name;
      const isAssignedToYou = note.task_owner === 'you' || 
                              note.task_owner === youName ||
                              note.task_owner === userId;
      
      return {
        id: note.id,
        summary: note.summary,
        createdAt: note.createdAt,
        isAssignedToYou,
        type: isAssignedToYou ? 'assigned' : 'added' as const
      };
    });
  }, [notes, userId, currentCouple]);

  // Don't show widget if no couple
  if (!currentCouple || !partner) {
    return null;
  }

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
            {t('home:partnerActivity.title', { name: partnerName })}
          </span>
        </div>
        <div className="px-3 py-4 rounded-lg bg-muted/20 border border-border/30 text-center">
          <p className="text-xs text-muted-foreground italic">
            {t('home:partnerActivity.empty', { name: partnerName })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up stagger-2 mt-6">
      <div className="flex items-center gap-2 mb-3 px-1">
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          {t('home:partnerActivity.title', { name: partnerName })}
        </span>
      </div>
      
      <div className="space-y-2">
        {partnerActivity.slice(0, 2).map((activity) => (
          <button
            key={activity.id}
            onClick={() => handleActivityClick(activity.id)}
            className="w-full text-left px-4 py-3 rounded-xl bg-muted/30 hover:bg-muted/50 
                       border border-border/50 transition-all duration-200 group active:scale-[0.98]"
          >
            <div className="flex items-start gap-3">
              {/* Larger avatar with white ring */}
              <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
                ring-2 ring-white shadow-sm
                ${activity.isAssignedToYou 
                  ? 'bg-accent/20 text-accent' 
                  : 'bg-primary/10 text-primary'
                }`}>
                {activity.isAssignedToYou 
                  ? <UserPlus className="w-3.5 h-3.5" />
                  : <Users className="w-3.5 h-3.5" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground leading-tight">
                  {activity.isAssignedToYou ? (
                    <span>
                      <span className="font-medium text-foreground">{partnerName}</span>
                      {' '}{t('home:partnerActivity.assignedYou')}
                    </span>
                  ) : (
                    <span>
                      <span className="font-medium text-foreground">{partnerName}</span>
                      {' '}{t('home:partnerActivity.added')}
                    </span>
                  )}
                </p>
                <p className="text-sm font-medium text-foreground truncate mt-1 group-hover:text-primary transition-colors">
                  {activity.summary}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary 
                                     opacity-0 group-hover:opacity-100 transition-all mt-1" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
