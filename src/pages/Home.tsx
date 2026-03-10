import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TrendingUp, Sparkles, CalendarPlus, Brain, Clock, Wand2, Loader2, Bell, Mail, CalendarDays, Undo2, Search, Coffee } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { TaskItem } from "@/components/TaskItem";
import type { Note } from "@/types/note";
import { Skeleton } from "@/components/ui/skeleton";
import { NoteInput } from "@/components/NoteInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, addDays, startOfDay, isSameDay, formatDistanceToNow } from "date-fns";
import { useDateLocale } from "@/hooks/useDateLocale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Categories are now derived dynamically from user's actual notes
import { useOrganizeAgent } from "@/hooks/useOrganizeAgent";
import { OptimizationReviewModal } from "@/components/OptimizationReviewModal";
import { useOnboardingTooltip } from "@/hooks/useOnboardingTooltip";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";
import { PartnerActivityWidget } from "@/components/PartnerActivityWidget";
import { InsightDiscoveryCard } from "@/components/InsightDiscoveryCard";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { PrivacyFilterPills } from "@/components/PrivacyFilterPills";
import { useDefaultPrivacyFilter } from "@/hooks/useDefaultPrivacyFilter";
import { EmailTriageReviewDialog } from "@/components/EmailTriageReviewDialog";
import { PartnerInviteCard } from "@/components/PartnerInviteCard";
import { PersonalizeCard } from "@/components/PersonalizeCard";
import { SetupFeaturesCard } from "@/components/SetupFeaturesCard";
import { supabase } from "@/lib/supabaseClient";
import { useHaptics } from "@/hooks/useHaptics";
import { useKeyboardShortcuts, APP_SHORTCUTS } from "@/hooks/useKeyboardShortcuts";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const Home = () => {
  const { t } = useTranslation(['home', 'common']);
  const { getLocalizedPath } = useLanguage();
  const dateLocale = useDateLocale();
  
  useSEO({ 
    title: "Home — Olive", 
    description: "Your AI-powered task organizer for couples." 
  });

  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { you, partner, currentCouple, members, getMemberName } = useSupabaseCouple();
  const { notes, loading: notesLoading, updateNote, refetch: refetchNotes } = useSupabaseNotesContext();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [defaultHomeTab] = useState(() => localStorage.getItem('olive_default_home_tab') || 'weekly');
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const { privacyFilter, setPrivacyFilter } = useDefaultPrivacyFilter();
  const { connection: calendarConnection } = useCalendarEvents();
  const [emailTriageOpen, setEmailTriageOpen] = useState(false);
  const [emailConnected, setEmailConnected] = useState(false);
  // Haptics and keyboard shortcuts
  const haptics = useHaptics();
  const [searchOpen, setSearchOpen] = useState(false);
  const brainDumpRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard shortcuts: Cmd+K (search), Cmd+N (new note)
  useKeyboardShortcuts([
    {
      ...APP_SHORTCUTS.SEARCH,
      callback: () => setSearchOpen(true),
    },
    {
      ...APP_SHORTCUTS.NEW_NOTE,
      callback: () => {
        // Focus the brain dump input
        const input = document.querySelector('[data-brain-dump-input]') as HTMLTextAreaElement;
        if (input) input.focus();
      },
    },
  ]);

  // Check if Gmail is connected
  useEffect(() => {
    if (!user?.id) return;
    supabase.functions.invoke('olive-email-mcp', {
      body: { action: 'status', user_id: user.id },
    }).then(({ data }) => {
      if (data?.success && data?.connected) setEmailConnected(true);
    }).catch(() => {});
  }, [user?.id]);

  // Determine whether there are any shared notes (to conditionally show shared pill)
  const hasSharedNotes = useMemo(() => notes.some(n => n.isShared), [notes]);
  
  // Organize Agent
  const {
    isAnalyzing,
    isApplying,
    plan,
    isModalOpen,
    setIsModalOpen,
    analyze,
    applyPlan,
  } = useOrganizeAgent({ coupleId: currentCouple?.id, onComplete: refetchNotes });
  
  // Onboarding tooltip for Organize feature
  const organizeOnboarding = useOnboardingTooltip('organize_feature');
  
  // Onboarding tooltip for Brain Dump feature
  const brainDumpOnboarding = useOnboardingTooltip('brain_dump_feature');

  // Get user's display name - prioritize full first name over initials
  const userName = isAuthenticated 
    ? (user?.firstName || you || user?.fullName?.split(' ')[0] || "there") 
    : "there";

  // Apply filters to notes
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      if (categoryFilter !== "all" && note.category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (ownerFilter !== "all") {
        // Support both user_id and legacy name-based matching
        if (note.task_owner !== ownerFilter && note.authorId !== ownerFilter) return false;
      }
      if (privacyFilter === "private" && note.isShared) return false;
      if (privacyFilter === "shared" && !note.isShared) return false;
      return true;
    });
  }, [notes, categoryFilter, ownerFilter, privacyFilter]);

  // Get priority tasks (top 5 ordered by priority)
  const priorityTasks = useMemo(() => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return filteredNotes
      .filter(note => !note.completed)
      .sort((a, b) => {
        const aPriority = priorityOrder[a.priority || 'low'];
        const bPriority = priorityOrder[b.priority || 'low'];
        if (aPriority !== bPriority) return bPriority - aPriority;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .slice(0, 5);
  }, [filteredNotes]);

  // Get recent tasks (last 5 added)
  const recentTasks = useMemo(() => {
    return filteredNotes
      .filter(note => !note.completed)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [filteredNotes]);

  // Get upcoming reminders (tasks with reminder_time in the future, sorted soonest first)
  const upcomingReminders = useMemo(() => {
    const now = new Date();
    return filteredNotes
      .filter(note => {
        if (note.completed) return false;
        if (!note.reminder_time) return false;
        return new Date(note.reminder_time) > now;
      })
      .sort((a, b) => new Date(a.reminder_time!).getTime() - new Date(b.reminder_time!).getTime())
      .slice(0, 5);
  }, [filteredNotes]);

  // Helper to get tasks for a range of days
  const getTasksForDays = (dayOffsets: number[]) => {
    const today = startOfDay(new Date());
    return dayOffsets.map(offset => {
      const day = addDays(today, offset);
      return {
        date: day,
        tasks: filteredNotes
          .filter(note => {
            if (note.completed) return false;
            if (!note.dueDate) return false;
            const taskDate = startOfDay(new Date(note.dueDate));
            return isSameDay(taskDate, day);
          })
          .sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            const aPriority = priorityOrder[a.priority || 'low'];
            const bPriority = priorityOrder[b.priority || 'low'];
            return bPriority - aPriority;
          })
      };
    });
  };

  // Get weekly view tasks (next 5 days)

  // Get weekly view tasks (next 5 days)
  const weeklyViewTasks = useMemo(() => getTasksForDays([0, 1, 2, 3, 4]), [filteredNotes]);

  // Get completed tasks this week
  const completedThisWeek = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    return notes.filter(note => 
      note.completed && 
      new Date(note.updatedAt) >= oneWeekAgo
    ).length;
  }, [notes]);

  // Optimistic UI for task completion with undo
  const handleToggleComplete = useCallback(async (task: Note) => {
    const previousState = task.completed;
    const newState = !previousState;
    
    // Optimistic update - immediate UI feedback
    // Note: We can't directly mutate state, but TaskItem handles animation
    
    // Haptic feedback on native
    if (newState) {
      haptics.notificationSuccess();
    } else {
      haptics.impactLight();
    }
    
    // Show toast with undo action
    if (newState) {
      toast(t('home:toast.taskCompleted', 'Task completed! 🎉'), {
        description: task.summary,
        action: {
          label: t('common:buttons.undo', 'Undo'),
          onClick: async () => {
            // Revert the completion
            await updateNote(task.id, { completed: false });
            haptics.impactLight();
          },
        },
        duration: 5000,
      });
    }
    
    // Perform the actual update
    try {
      await updateNote(task.id, { completed: newState });
    } catch (error) {
      // Rollback on error - refetch to restore state
      console.error('Failed to toggle task:', error);
      toast.error(t('home:toast.updateFailed', 'Failed to update task'));
      refetchNotes();
    }
  }, [updateNote, haptics, t, refetchNotes]);

  const handleTaskClick = (task: Note) => {
    navigate(getLocalizedPath(`/notes/${task.id}`));
  };

  const getAuthorName = (note: Note) => {
    // For private tasks, always show the actual author
    if (!note.isShared && note.authorId) {
      if (note.authorId === user?.id) return t('home:taskOwner.you', 'You');
      const resolved = getMemberName(note.authorId);
      return resolved !== 'Unknown' ? resolved : note.addedBy;
    }
    // For shared tasks, use task_owner if set, otherwise resolve from authorId
    if (note.task_owner) {
      // If the resolved task_owner matches the current user, show "You"
      if (note.authorId === user?.id && (!note.task_owner.startsWith('user_'))) {
        // task_owner was resolved to a display name — check if it's actually us
        const currentUserName = getMemberName(user?.id || '');
        if (note.task_owner === currentUserName) return t('home:taskOwner.you', 'You');
      }
      const resolved = getMemberName(note.task_owner);
      if (resolved !== 'Unknown') return resolved;
      return note.task_owner;
    }
    // No task_owner on a shared task — resolve from authorId
    if (note.authorId) {
      if (note.authorId === user?.id) return t('home:taskOwner.you', 'You');
      return getMemberName(note.authorId);
    }
    return t('home:taskOwner.everyone', 'Everyone');
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center animate-fade-up">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
          <Brain className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">{t('home:notAuthenticated.title')}</h2>
        <p className="text-muted-foreground mb-6">{t('home:notAuthenticated.subtitle')}</p>
        <Button size="lg" onClick={() => navigate(getLocalizedPath('/sign-in'))}>{t('common:buttons.signIn')}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-32 scrollbar-thin relative z-10">
        {/* Reduced spacing between sections for tighter layout */}
        <div className="px-4 md:px-0 pt-4 md:pt-0 space-y-6 md:space-y-8">

          {/* Loading Skeleton State */}
          {notesLoading && (
            <div className="space-y-6 animate-fade-up">
              {/* Greeting skeleton */}
              <div className="text-center md:text-left">
                <Skeleton className="h-12 w-3/4 mb-3 mx-auto md:mx-0" />
                <Skeleton className="h-6 w-1/2 mx-auto md:mx-0" />
              </div>
              {/* Input skeleton */}
              <Skeleton className="h-24 w-full rounded-2xl" />
              {/* Tasks skeleton */}
              <div className="bg-card rounded-3xl shadow-xl border border-border/50 overflow-hidden p-6 md:p-10 space-y-4">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-12 w-full rounded-full" />
                <div className="space-y-3 pt-4">
                  {[1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            </div>
          )}

          {!notesLoading && (<>
          {/* Greeting Section - MASSIVE SERIF Typography for Desktop */}
          <div className="text-center md:text-left animate-fade-up">
            <h1 className="font-serif font-bold text-4xl md:text-5xl lg:text-6xl xl:text-7xl tracking-tight text-foreground mb-3 md:mb-4">
              {t('home:greeting', { name: userName })}
            </h1>
            <p className="text-lg md:text-xl lg:text-2xl text-muted-foreground font-light leading-relaxed">
              {t('home:whatsOnMind')}
            </p>
          </div>

          {/* Brain-dump Input - Inline, directly usable */}
          <div className="relative animate-fade-up stagger-1">
            <div onClick={() => {
              if (brainDumpOnboarding.isVisible) {
                brainDumpOnboarding.dismiss();
              }
            }}>
              <NoteInput onNoteAdded={() => refetchNotes()} />
            </div>
            
            {/* Onboarding Tooltip */}
            <OnboardingTooltip
              isVisible={brainDumpOnboarding.isVisible}
              onDismiss={brainDumpOnboarding.dismiss}
              title={t('home:brainDump.onboarding.title')}
              description={t('home:brainDump.onboarding.description')}
              position="bottom"
            />
          </div>

          {/* Partner Invite Card (post-onboarding) */}
          <div className="animate-fade-up stagger-2">
            <PartnerInviteCard />
          </div>

          {/* Personalize Olive Card (post-onboarding) */}
          <div className="animate-fade-up stagger-2">
            <PersonalizeCard />
          </div>

          {/* Quick Action Cards - Glass Style (only show if no notes) */}
          {notes.length === 0 && !calendarConnection?.connected && (
            <div className="space-y-4 animate-fade-up stagger-3">
              <div 
                className="card-glass p-6 cursor-pointer hover:scale-[1.01] transition-all duration-300"
                onClick={() => navigate(getLocalizedPath('/calendar'))}
              >
                <div className="flex items-center gap-4">
                  <div className="icon-squircle-lg bg-gradient-to-br from-info/10 to-info/5">
                    <CalendarPlus className="w-6 h-6 text-info" />
                  </div>
                  <div>
                    <p className="heading-card">{t('home:connectCalendar.title')}</p>
                    <p className="text-sm text-muted-foreground">{t('home:connectCalendar.subtitle')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Optimize Organization - Compact Inline Button */}
          {notes.length >= 3 && (
            <div className="relative flex justify-center animate-fade-up stagger-2">
              <button
                onClick={() => {
                  if (organizeOnboarding.isVisible) {
                    organizeOnboarding.dismiss();
                  }
                  if (!isAnalyzing) {
                    analyze("all");
                  }
                }}
                disabled={isAnalyzing}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground 
                           hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors group
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAnalyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                )}
                <span>{t('home:organize.title')}</span>
              </button>
              
              {/* Onboarding Tooltip */}
              <OnboardingTooltip
                isVisible={organizeOnboarding.isVisible}
                onDismiss={organizeOnboarding.dismiss}
                title={t('home:organize.onboarding.title')}
                description={t('home:organize.onboarding.description')}
                position="bottom"
            />
          </div>
          )}

          {/* Review my Email - pill button */}
          {emailConnected && (
            <div className="flex justify-center animate-fade-up stagger-2">
              <button
                onClick={() => setEmailTriageOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground 
                           hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors group"
              >
                <Mail className="w-4 h-4 group-hover:scale-110 transition-transform" />
                <span>{t('home:emailTriage.reviewButton', 'Review my Email')}</span>
              </button>
            </div>
          )}

          {/* Insight Discovery Card - Shows AI-discovered patterns */}
          <InsightDiscoveryCard />

          {/* Partner Activity Widget - Only show on mobile/tablet (moved to Context Rail on xl) */}
          <div className="xl:hidden">
            <PartnerActivityWidget notes={notes} />
          </div>

          {/* Tabs Widget - PREMIUM CARD: Subtle shadow, generous padding */}
          <div className="bg-card rounded-3xl shadow-xl border border-border/50 overflow-hidden animate-fade-up stagger-3">
            <Tabs defaultValue={defaultHomeTab} className="w-full">
              {/* Header with tabs and filters - EDITORIAL STYLE */}
              <div className="px-6 md:px-10 py-6 md:py-8 border-b border-border">
                {/* Section Label - UPPERCASE tracking-widest */}
                <p className="text-xs md:text-sm uppercase tracking-widest font-bold text-muted-foreground mb-4 md:mb-6">
                  {t('home:tabs.sectionLabel', 'Your Tasks')}
                </p>
                
                <TabsList className="w-full grid grid-cols-4 bg-muted/80 mb-5 md:mb-6 h-12 md:h-14 rounded-full p-1">
                  <TabsTrigger value="priority" className="text-xs md:text-sm font-semibold rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg">
                    {t('home:tabs.priority')}
                  </TabsTrigger>
                  <TabsTrigger value="weekly" className="text-xs md:text-sm font-semibold rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg">
                    {t('home:tabs.weekly')}
                  </TabsTrigger>
                  <TabsTrigger value="reminders" className="text-xs md:text-sm font-semibold rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg">
                    {t('home:tabs.reminders')}
                  </TabsTrigger>
                  <TabsTrigger value="recent" className="text-xs md:text-sm font-semibold rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-lg">
                    {t('home:tabs.recent')}
                  </TabsTrigger>
                </TabsList>
                
                {/* Filters - Pill Style */}
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="h-10 text-sm flex-1 bg-background/80 rounded-full border-border/50 shadow-sm">
                        <SelectValue placeholder={t('common:common.allCategories')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common:common.allCategories')}</SelectItem>
                        {/* Dynamic categories from user's actual notes */}
                        {(() => {
                          const uniqueCategories = [...new Set(notes.map(n => n.category))].sort();
                          return uniqueCategories.map(cat => (
                            <SelectItem key={cat} value={cat.toLowerCase()}>
                              {t(`common:categories.${cat.toLowerCase().replace(/\s+/g, '_')}`, cat)}
                            </SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    
                    {currentCouple && members.length > 0 && (
                      <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                        <SelectTrigger className="h-10 text-sm flex-1 bg-background/80 rounded-full border-border/50 shadow-sm">
                          <SelectValue placeholder={t('common:common.everyone')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('common:common.everyone')}</SelectItem>
                          {members.map(m => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.display_name} {m.user_id === user?.id ? `(${t('common:common.you', 'You')})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Privacy Filter Pills - only show when in a couple */}
                  {currentCouple && (
                    <PrivacyFilterPills
                      value={privacyFilter}
                      onChange={setPrivacyFilter}
                      hasShared={hasSharedNotes}
                    />
                  )}
                </div>
              </div>
              {/* Priority Tab - DESKTOP PADDING p-8, space-y-5 for breathing room */}
              <TabsContent value="priority" className="mt-0">
                <div className="p-4 md:p-8 space-y-4 md:space-y-5">
                  {priorityTasks.length > 0 ? (
                    priorityTasks.map((task, index) => (
                      <div key={task.id} className={`animate-fade-up stagger-${Math.min(index + 1, 5)}`}>
                        <TaskItem
                          task={task}
                          onToggleComplete={handleToggleComplete}
                          onTaskClick={handleTaskClick}
                          authorName={getAuthorName(task)}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 md:py-16 text-muted-foreground">
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                        <Sparkles className="w-7 h-7 md:w-8 md:h-8" />
                      </div>
                      <p className="text-base md:text-lg font-medium">{t('home:emptyState.noTasksMatch')}</p>
                      <p className="text-sm md:text-base mt-2">{t('home:emptyState.adjustFilters')}</p>
                    </div>
                  )}
                </div>
              </TabsContent>



              {/* Weekly Tab - 5-day view */}
              <TabsContent value="weekly" className="mt-0">
                <div className="p-4 md:p-8 space-y-1 md:space-y-2">
                  {/* Check if ALL days have no tasks for motivational empty state */}
                  {weeklyViewTasks.every(d => d.tasks.length === 0) ? (
                    <div className="flex flex-col items-center justify-center py-12 md:py-16 text-center animate-fade-up">
                      <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4 md:mb-6">
                        <Coffee className="w-8 h-8 md:w-10 md:h-10 text-primary" />
                      </div>
                      <h3 className="text-xl md:text-2xl font-serif font-bold text-foreground mb-2">
                        {t('home:weekly.emptyTitle', 'Your week looks clear!')}
                      </h3>
                      <p className="text-muted-foreground text-sm md:text-base max-w-xs md:max-w-sm">
                        {t('home:weekly.emptyDescription', 'Enjoy the calm, or brain dump some ideas above to start planning.')}
                      </p>
                    </div>
                  ) : (
                    weeklyViewTasks.map((dayData, dayIndex) => {
                      const isToday = dayIndex === 0;
                      const isTomorrow = dayIndex === 1;
                      const dayLabel = isToday
                        ? t('common:common.today')
                        : isTomorrow
                        ? t('common:common.tomorrow')
                        : format(dayData.date, 'EEEE', { locale: dateLocale });
                      const taskCount = dayData.tasks.length;

                      return (
                        <div
                          key={dayData.date.toISOString()}
                          className={`animate-fade-up stagger-${Math.min(dayIndex + 1, 5)} rounded-2xl border transition-colors ${
                            isToday
                              ? 'border-primary/20 bg-primary/[0.03]'
                              : 'border-stone-100 bg-white/60'
                          } overflow-hidden`}
                        >
                          {/* Day header */}
                          <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center text-xs md:text-sm font-bold ${
                                isToday
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-stone-100 text-stone-500'
                              }`}>
                                {format(dayData.date, 'd')}
                              </div>
                              <div>
                                <p className={`text-sm md:text-base font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>
                                  {dayLabel}
                                </p>
                              <p className="text-[11px] md:text-xs text-muted-foreground">
                                {format(dayData.date, 'MMM d', { locale: dateLocale })}
                              </p>
                              </div>
                            </div>
                            {taskCount > 0 && (
                              <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                                {taskCount} {taskCount === 1 ? t('home:weekly.task') : t('home:weekly.tasks')}
                              </span>
                            )}
                          </div>

                          {/* Tasks for this day - only show section if has tasks */}
                          {taskCount > 0 && (
                            <div className="px-4 md:px-6 pb-3 md:pb-4 space-y-3 md:space-y-4">
                              {dayData.tasks.map((task) => (
                                <TaskItem
                                  key={task.id}
                                  task={task}
                                  onToggleComplete={handleToggleComplete}
                                  onTaskClick={handleTaskClick}
                                  authorName={getAuthorName(task)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </TabsContent>


              <TabsContent value="reminders" className="mt-0">
                <div className="p-4 md:p-8 space-y-4 md:space-y-5">
                  {upcomingReminders.length > 0 ? (
                    upcomingReminders.map((task, index) => (
                      <div key={task.id} className={`animate-fade-up stagger-${Math.min(index + 1, 5)}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Bell className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                          <span className="text-sm md:text-base text-muted-foreground">
                            {formatDistanceToNow(new Date(task.reminder_time!), { addSuffix: true, locale: dateLocale })}
                          </span>
                        </div>
                        <TaskItem
                          task={task}
                          onToggleComplete={handleToggleComplete}
                          onTaskClick={handleTaskClick}
                          authorName={getAuthorName(task)}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 md:py-16 text-muted-foreground">
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                        <Bell className="w-7 h-7 md:w-8 md:h-8" />
                      </div>
                      <p className="text-base md:text-lg font-medium">{t('home:emptyState.noReminders')}</p>
                      <p className="text-sm md:text-base mt-2">{t('home:emptyState.setReminders')}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Recent Tab - DESKTOP PADDING */}
              <TabsContent value="recent" className="mt-0">
                <div className="p-4 md:p-8 space-y-4 md:space-y-5">
                  {recentTasks.length > 0 ? (
                    recentTasks.map((task, index) => (
                      <div key={task.id} className={`animate-fade-up stagger-${Math.min(index + 1, 5)}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground" />
                          <span className="text-sm md:text-base text-muted-foreground">
                            {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true, locale: dateLocale })}
                          </span>
                        </div>
                        <TaskItem
                          task={task}
                          onToggleComplete={handleToggleComplete}
                          onTaskClick={handleTaskClick}
                          authorName={getAuthorName(task)}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 md:py-16 text-muted-foreground">
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                        <Clock className="w-7 h-7 md:w-8 md:h-8" />
                      </div>
                      <p className="text-base md:text-lg font-medium">{t('home:emptyState.noRecentTasks')}</p>
                      <p className="text-sm md:text-base mt-2">{t('home:emptyState.addFirstTask')}</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Motivation Link */}
          {completedThisWeek > 0 && (
            <button
              onClick={() => navigate(getLocalizedPath('/lists?filter=completed'))}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm text-success hover:text-success/80 transition-colors animate-fade-up"
            >
              <TrendingUp className="h-4 w-4" />
              <span className="font-medium">
                {t('home:completedThisWeek', { count: completedThisWeek })}
              </span>
            </button>
          )}
          </>)}
        </div>
      </div>


      {/* Optimization Review Modal */}
      <OptimizationReviewModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        plan={plan}
        onApply={applyPlan}
        isApplying={isApplying}
      />

      {/* Email Triage Review Dialog */}
      <EmailTriageReviewDialog
        open={emailTriageOpen}
        onOpenChange={setEmailTriageOpen}
      />

      {/* Command Palette (Cmd+K) */}
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <CommandInput placeholder={t('home:search.placeholder', 'Search tasks, lists...')} />
        <CommandList>
          <CommandEmpty>{t('home:search.noResults', 'No results found')}</CommandEmpty>
          <CommandGroup heading={t('home:search.tasks', 'Tasks')}>
            {filteredNotes.slice(0, 8).map((task) => (
              <CommandItem
                key={task.id}
                onSelect={() => {
                  navigate(getLocalizedPath(`/notes/${task.id}`));
                  setSearchOpen(false);
                }}
              >
                <span className={task.completed ? 'line-through text-muted-foreground' : ''}>
                  {task.summary}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
};

export default Home;
