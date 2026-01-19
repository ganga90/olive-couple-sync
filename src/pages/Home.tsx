import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TrendingUp, Sparkles, CalendarPlus, Brain, Clock, Wand2, Loader2 } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { TaskItem } from "@/components/TaskItem";
import type { Note } from "@/types/note";
import { NoteInput } from "@/components/NoteInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, addDays, startOfDay, isSameDay, formatDistanceToNow } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categories } from "@/constants/categories";
import { useOrganizeAgent } from "@/hooks/useOrganizeAgent";
import { OptimizationReviewModal } from "@/components/OptimizationReviewModal";
import { useOnboardingTooltip } from "@/hooks/useOnboardingTooltip";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";
import { PartnerActivityWidget } from "@/components/PartnerActivityWidget";

const Home = () => {
  const { t } = useTranslation(['home', 'common']);
  const { getLocalizedPath } = useLanguage();
  
  useSEO({ 
    title: "Home — Olive", 
    description: "Your AI-powered task organizer for couples." 
  });

  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { you, partner, currentCouple } = useSupabaseCouple();
  const { notes, updateNote, refetch: refetchNotes } = useSupabaseNotesContext();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  
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

  const userName = isAuthenticated ? (user?.firstName || user?.fullName || you || "there") : "there";

  // Apply filters to notes
  const filteredNotes = useMemo(() => {
    return notes.filter(note => {
      if (categoryFilter !== "all" && note.category.toLowerCase() !== categoryFilter.toLowerCase()) return false;
      if (ownerFilter !== "all" && note.task_owner !== ownerFilter) return false;
      return true;
    });
  }, [notes, categoryFilter, ownerFilter]);

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

  // Get daily view tasks (next 3 days)
  const dailyViewTasks = useMemo(() => {
    const today = startOfDay(new Date());
    const next3Days = [0, 1, 2].map(offset => addDays(today, offset));
    
    return next3Days.map(day => ({
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
    }));
  }, [filteredNotes]);

  // Get completed tasks this week
  const completedThisWeek = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    return notes.filter(note => 
      note.completed && 
      new Date(note.updatedAt) >= oneWeekAgo
    ).length;
  }, [notes]);

  const handleToggleComplete = async (task: Note) => {
    await updateNote(task.id, { completed: !task.completed });
  };

  const handleTaskClick = (task: Note) => {
    navigate(getLocalizedPath(`/notes/${task.id}`));
  };

  const getAuthorName = (note: Note) => {
    if (note.task_owner === 'you') return you || 'You';
    if (note.task_owner === 'partner') return partner || 'Partner';
    return 'Both';
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
    <div className="flex flex-col h-full atmosphere-bg">
      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-32 scrollbar-thin relative z-10">
        <div className="px-4 lg:px-0 pt-8 lg:pt-12 space-y-8 lg:space-y-10">
          {/* Greeting Section - Massive Editorial Typography */}
          <div className="text-center animate-fade-up">
            <h1 className="heading-massive lg:text-5xl xl:text-6xl mb-2 lg:mb-4">
              {t('home:greeting', { name: userName })}
            </h1>
            <p className="text-lg lg:text-xl text-stone-500 font-light">
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

          {/* Quick Action Cards - Glass Style (only show if no notes) */}
          {notes.length === 0 && (
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
                    <p className="text-sm text-stone-500">{t('home:connectCalendar.subtitle')}</p>
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

          {/* Partner Activity Widget */}
          <PartnerActivityWidget notes={notes} />

          {/* Tabs Widget - Frosted Glass Card */}
          <div className="card-glass overflow-hidden animate-fade-up stagger-3">
            <Tabs defaultValue="priority" className="w-full">
              <div className="bg-stone-50/50 backdrop-blur-sm px-6 py-5 border-b border-stone-100/50">
                <TabsList className="w-full grid grid-cols-3 bg-white/80 mb-4 h-12 rounded-full p-1 shadow-sm">
                  <TabsTrigger value="priority" className="text-sm font-medium rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">
                    {t('home:tabs.priority')}
                  </TabsTrigger>
                  <TabsTrigger value="daily" className="text-sm font-medium rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">
                    {t('home:tabs.daily')}
                  </TabsTrigger>
                  <TabsTrigger value="recent" className="text-sm font-medium rounded-full transition-all duration-300 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-md">
                    {t('home:tabs.recent')}
                  </TabsTrigger>
                </TabsList>
                
                {/* Filters - Pill Style */}
                <div className="flex gap-3">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-10 text-sm flex-1 bg-white/80 rounded-full border-stone-200/50 shadow-sm">
                      <SelectValue placeholder={t('common:common.allCategories')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('common:common.allCategories')}</SelectItem>
                      {categories.map(cat => (
                        <SelectItem key={cat} value={cat.toLowerCase()}>{t(`common:categories.${cat.toLowerCase().replace(/\s+/g, '_')}`, cat)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="h-10 text-sm flex-1 bg-white/80 rounded-full border-stone-200/50 shadow-sm">
                      <SelectValue placeholder={t('common:common.everyone')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('common:common.everyone')}</SelectItem>
                      <SelectItem value="you">{you || t('common:common.you')}</SelectItem>
                      <SelectItem value="partner">{partner || t('common:common.partner')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <TabsContent value="priority" className="mt-0">
                <div className="p-4 space-y-2">
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
                    <div className="text-center py-10 text-muted-foreground">
                      <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-medium">{t('home:emptyState.noTasksMatch')}</p>
                      <p className="text-xs mt-1">{t('home:emptyState.adjustFilters')}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="daily" className="mt-0">
                <div className="p-4 space-y-5">
                  {dailyViewTasks.map((dayData, dayIndex) => (
                    <div key={dayData.date.toISOString()} className={`animate-fade-up stagger-${Math.min(dayIndex + 1, 3)}`}>
                      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <span className={dayIndex === 0 ? "text-primary" : ""}>
                          {dayIndex === 0 ? t('common:common.today') : dayIndex === 1 ? t('common:common.tomorrow') : format(dayData.date, 'EEEE')}
                        </span>
                        <span className="text-muted-foreground font-normal">
                          {format(dayData.date, 'MMM d')}
                        </span>
                      </h3>
                      {dayData.tasks.length > 0 ? (
                        <div className="space-y-2">
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
                      ) : (
                        <div className="text-center py-4 text-muted-foreground text-xs bg-muted/30 rounded-lg">
                          {t('home:emptyState.noTasksScheduled')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="recent" className="mt-0">
                <div className="p-4 space-y-2">
                  {recentTasks.length > 0 ? (
                    recentTasks.map((task, index) => (
                      <div key={task.id} className={`animate-fade-up stagger-${Math.min(index + 1, 5)}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
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
                    <div className="text-center py-10 text-muted-foreground">
                      <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
                        <Clock className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-medium">{t('home:emptyState.noRecentTasks')}</p>
                      <p className="text-xs mt-1">{t('home:emptyState.addFirstTask')}</p>
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
    </div>
  );
};

export default Home;
