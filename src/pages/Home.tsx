import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TrendingUp, Filter } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { TaskItem } from "@/components/TaskItem";
import { QuickEditBottomSheet } from "@/components/QuickEditBottomSheet";
import type { Note } from "@/types/note";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NoteInput } from "@/components/NoteInput";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, addDays, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categories } from "@/constants/categories";

const Home = () => {
  useSEO({ 
    title: "Home — Olive", 
    description: "Your AI-powered task organizer for couples." 
  });

  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { you, partner } = useSupabaseCouple();
  const { notes, updateNote } = useSupabaseNotesContext();
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Note | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

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
    setSelectedTask(task);
  };

  const handleQuickSave = async (noteId: string, updates: Partial<Note>) => {
    await updateNote(noteId, updates);
  };

  const getAuthorName = (note: Note) => {
    if (note.task_owner === 'you') return you || 'You';
    if (note.task_owner === 'partner') return partner || 'Partner';
    return 'Both';
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <h2 className="text-2xl font-semibold mb-2">Welcome to Olive</h2>
        <p className="text-muted-foreground mb-6">Please sign in to continue</p>
        <Button onClick={() => navigate('/sign-in')}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-y-auto pb-6">
        <div className="px-4 pt-6 space-y-6">
          {/* Greeting */}
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Hi, {userName} 👋
            </h1>
            <p className="text-sm text-muted-foreground">
              What's on your mind today?
            </p>
          </div>

          {/* Input Box - Prominent with Green Border */}
          <div 
            onClick={() => setIsInputOpen(true)}
            className="bg-card border-2 border-primary rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-raised)] cursor-pointer hover:border-primary/80 hover:shadow-lg transition-all active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-foreground font-medium text-base">
                  Drop a brain-dump here...
                </p>
              </div>
              <Plus className="h-6 w-6 text-primary" />
            </div>
          </div>

          {/* Guidance Hint */}
          <div className="text-center px-2">
            <p className="text-xs text-muted-foreground">
              Try: <span className="italic">"dinner with Luca next Wed 7pm, ask Almu about tickets"</span>
            </p>
          </div>

          {/* Tabs Widget with Filters */}
          <Card className="overflow-hidden">
            <Tabs defaultValue="priority" className="w-full">
              <div className="bg-primary/5 px-4 py-3 border-b">
                <TabsList className="w-full grid grid-cols-2 bg-background/50 mb-3">
                  <TabsTrigger value="priority" className="text-xs">Priority Tasks</TabsTrigger>
                  <TabsTrigger value="daily" className="text-xs">Daily View</TabsTrigger>
                </TabsList>
                
                {/* Filters */}
                <div className="flex gap-2">
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories.map(cat => (
                        <SelectItem key={cat} value={cat.toLowerCase()}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everyone</SelectItem>
                      <SelectItem value="you">{you || 'You'}</SelectItem>
                      <SelectItem value="partner">{partner || 'Partner'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <TabsContent value="priority" className="mt-0">
                <div className="p-4 space-y-2">
                  {priorityTasks.length > 0 ? (
                    priorityTasks.map((task) => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onToggleComplete={handleToggleComplete}
                        onTaskClick={handleTaskClick}
                        authorName={getAuthorName(task)}
                      />
                    ))
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No tasks match the current filters
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="daily" className="mt-0">
                <div className="p-4 space-y-4">
                  {dailyViewTasks.map((dayData) => (
                    <div key={dayData.date.toISOString()}>
                      <h3 className="text-sm font-semibold text-foreground mb-2">
                        {format(dayData.date, 'EEEE, MMM d')}
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
                        <div className="text-center py-4 text-muted-foreground text-xs">
                          No tasks scheduled
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </Card>

          {/* Motivation Link */}
          {completedThisWeek > 0 && (
            <button
              onClick={() => navigate('/lists?filter=completed')}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm text-accent hover:text-accent/80 transition-colors"
            >
              <TrendingUp className="h-4 w-4" />
              <span>
                View {completedThisWeek} {completedThisWeek === 1 ? 'task' : 'tasks'} completed this week - Motivate Me!
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Input Dialog */}
      <Dialog open={isInputOpen} onOpenChange={setIsInputOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Drop a brain-dump here...</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            <NoteInput 
              onNoteAdded={() => setIsInputOpen(false)} 
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Quick Edit Bottom Sheet */}
      <QuickEditBottomSheet
        note={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onSave={handleQuickSave}
        partnerName={partner}
        yourName={you}
      />
    </div>
  );
};

export default Home;
