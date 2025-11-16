import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TrendingUp } from "lucide-react";
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

  const userName = isAuthenticated ? (user?.firstName || user?.fullName || you || "there") : "there";

  // Get focus tasks (3-5 high priority tasks, ordered by creation date)
  const focusTasks = useMemo(() => {
    const highPriorityTasks = notes
      .filter(note => !note.completed && note.priority === 'high')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 5);
    
    return highPriorityTasks;
  }, [notes]);

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

          {/* Input Box */}
          <div 
            onClick={() => setIsInputOpen(true)}
            className="bg-card border rounded-[var(--radius-lg)] p-4 shadow-[var(--shadow-card)] cursor-pointer hover:shadow-[var(--shadow-raised)] transition-shadow active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-muted-foreground text-base">
                  Drop a brain-dump here...
                </p>
              </div>
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>

          {/* Guidance Hint */}
          <div className="text-center px-2">
            <p className="text-xs text-muted-foreground">
              Try: <span className="italic">"dinner with Luca next Wed 7pm, ask Almu about tickets"</span>
            </p>
          </div>

          {/* Focus Widget */}
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Your Focus</h2>
                {focusTasks.length > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {focusTasks.length} {focusTasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                )}
              </div>

              {focusTasks.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground mb-2">
                    No critical tasks right now
                  </p>
                  <p className="text-xs text-muted-foreground">
                    You're all caught up! 🎉
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {focusTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onToggleComplete={handleToggleComplete}
                      onTaskClick={handleTaskClick}
                      authorName={getAuthorName(task)}
                    />
                  ))}
                  
                  {notes.filter(n => !n.completed && n.priority === 'high').length > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => navigate('/lists')}
                    >
                      +{notes.filter(n => !n.completed && n.priority === 'high').length - 5} More High Priority Tasks
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
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
