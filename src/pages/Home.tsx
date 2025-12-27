import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus, TrendingUp, Sparkles, CalendarPlus, Brain, Clock, Wand2, Loader2 } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { TaskItem } from "@/components/TaskItem";
import type { Note } from "@/types/note";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NoteInput } from "@/components/NoteInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, addDays, startOfDay, isSameDay, formatDistanceToNow } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categories } from "@/constants/categories";
import { useOrganizeAgent } from "@/hooks/useOrganizeAgent";
import { OptimizationReviewModal } from "@/components/OptimizationReviewModal";
import { useOnboardingTooltip } from "@/hooks/useOnboardingTooltip";
import { OnboardingTooltip } from "@/components/OnboardingTooltip";

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
  const [isInputOpen, setIsInputOpen] = useState(false);
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
    <div className="flex flex-col h-full">
      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-6 scrollbar-thin">
        <div className="px-4 pt-6 space-y-5">
          {/* Greeting Section */}
          <div className="text-center animate-fade-up">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1">
              {t('home:greeting', { name: userName })}
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              {t('home:whatsOnMind')}
            </p>
          </div>

          {/* Brain-dump Input - Hero Style */}
          <div 
            onClick={() => setIsInputOpen(true)}
            className="group relative bg-card border-2 border-primary/30 rounded-2xl p-5 shadow-card cursor-pointer 
                       hover:border-primary hover:shadow-raised transition-all duration-300 
                       active:scale-[0.99] animate-fade-up stagger-1"
          >
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 
                              group-hover:bg-primary/20 transition-colors">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-foreground font-medium text-base mb-0.5">
                  {t('home:brainDump.title')}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {t('home:brainDump.subtitle')}
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0
                              shadow-sm group-hover:shadow-glow transition-shadow">
                <Plus className="h-5 w-5 text-primary-foreground" />
              </div>
            </div>
          </div>

          {/* Guidance Hint */}
          <div className="text-center px-2 animate-fade-up stagger-2">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3 text-accent" />
              <span>{t('home:hint.try')} </span>
              <span className="italic text-foreground/70">{t('home:hint.example')}</span>
            </p>
          </div>

          {/* Quick Action Cards (contextual) */}
          {notes.length === 0 && (
            <div className="space-y-2 animate-fade-up stagger-3">
              <Card className="p-4 border-l-4 border-l-primary bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors"
                    onClick={() => setIsInputOpen(true)}>
                <div className="flex items-center gap-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm text-foreground">{t('home:quickStart.title')}</p>
                    <p className="text-xs text-muted-foreground">{t('home:quickStart.subtitle')}</p>
                  </div>
                </div>
              </Card>
              
              <Card className="p-4 border-l-4 border-l-info bg-info/5 cursor-pointer hover:bg-info/10 transition-colors"
                    onClick={() => navigate(getLocalizedPath('/calendar'))}>
                <div className="flex items-center gap-3">
                  <CalendarPlus className="w-5 h-5 text-info" />
                  <div>
                    <p className="font-medium text-sm text-foreground">{t('home:connectCalendar.title')}</p>
                    <p className="text-xs text-muted-foreground">{t('home:connectCalendar.subtitle')}</p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Optimize Organization Button */}
          {notes.length >= 3 && (
            <div className="relative">
              <Card 
                onClick={() => {
                  if (organizeOnboarding.isVisible) {
                    organizeOnboarding.dismiss();
                  }
                  if (!isAnalyzing) {
                    analyze("all");
                  }
                }}
                className="p-4 border-l-4 border-l-accent bg-accent/5 cursor-pointer hover:bg-accent/10 
                           transition-colors animate-fade-up stagger-3 group"
              >
                <div className="flex items-center gap-3">
                  {isAnalyzing ? (
                    <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  ) : (
                    <Wand2 className="w-5 h-5 text-accent group-hover:rotate-12 transition-transform" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-sm text-foreground">{t('home:organize.title')}</p>
                    <p className="text-xs text-muted-foreground">{t('home:organize.subtitle')}</p>
                  </div>
                </div>
              </Card>
              
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

          {/* Tabs Widget with Filters */}
          <Card className="overflow-hidden shadow-card animate-fade-up stagger-3">
            <Tabs defaultValue="priority" className="w-full">
              <div className="bg-muted/50 px-4 py-3 border-b border-border/50">
                <TabsList className="w-full grid grid-cols-3 bg-background/80 mb-3 h-10">
                  <TabsTrigger value="priority" className="text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    {t('home:tabs.priority')}
                  </TabsTrigger>
                  <TabsTrigger value="daily" className="text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    {t('home:tabs.daily')}
                  </TabsTrigger>
                  <TabsTrigger value="recent" className="text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    {t('home:tabs.recent')}
                  </TabsTrigger>
                </TabsList>
                
                {/* Filters */}
                <div className="flex gap-2">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 text-xs flex-1 bg-background">
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
                    <SelectTrigger className="h-9 text-xs flex-1 bg-background">
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
          </Card>

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

      {/* Input Dialog */}
      <Dialog open={isInputOpen} onOpenChange={setIsInputOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 rounded-2xl">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              {t('home:brainDump.dialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <NoteInput 
              onNoteAdded={() => setIsInputOpen(false)} 
            />
          </div>
        </DialogContent>
      </Dialog>

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
