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
    const partnerNotes = notes
      .filter(note => {
        // Must be a shared note (has coupleId)
        if (!note.coupleId) return false;
        // Must be added by someone other than current user (partner)
        if (note.addedBy === userId) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3); // Get last 3 activities
    
    return partnerNotes.map(note => {
      // Determine if it was assigned to the current user
      const isAssignedToYou = note.task_owner === 'you';
      
      return {
        id: note.id,
        summary: note.summary,
        createdAt: note.createdAt,
        isAssignedToYou,
        type: isAssignedToYou ? 'assigned' : 'added' as const
      };
    });
  }, [notes, userId, currentCouple]);

  // Don't show widget if no couple or no partner activity
  if (!currentCouple || !partner || partnerActivity.length === 0) {
    return null;
  }

  const handleActivityClick = (noteId: string) => {
    navigate(getLocalizedPath(`/notes/${noteId}`));
  };

  return (
    <div className="animate-fade-up stagger-2">
      <div className="flex items-center gap-2 mb-2 px-1">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          {t('home:partnerActivity.title', { name: partnerName })}
        </span>
      </div>
      
      <div className="space-y-1.5">
        {partnerActivity.slice(0, 2).map((activity) => (
          <button
            key={activity.id}
            onClick={() => handleActivityClick(activity.id)}
            className="w-full text-left px-3 py-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 
                       border border-border/50 transition-colors group"
          >
            <div className="flex items-start gap-2.5">
              <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
                ${activity.isAssignedToYou 
                  ? 'bg-accent/20 text-accent' 
                  : 'bg-primary/10 text-primary'
                }`}>
                {activity.isAssignedToYou 
                  ? <UserPlus className="w-3 h-3" />
                  : <Users className="w-3 h-3" />
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
                <p className="text-sm font-medium text-foreground truncate mt-0.5 group-hover:text-primary transition-colors">
                  {activity.summary}
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-1">
                  {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                </p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-primary 
                                     opacity-0 group-hover:opacity-100 transition-all mt-1" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
