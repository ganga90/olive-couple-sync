import React, { useState, useMemo } from "react";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { Button } from "@/components/ui/button";
import { Plus, Heart, Clock, AlertCircle, Users, User } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { SimpleNoteInput } from "@/components/SimpleNoteInput";
import { NoteInput } from "@/components/NoteInput";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { RecentTasksSection } from "@/components/RecentTasksSection";
import { UniversalSearch } from "@/components/UniversalSearch";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

const Index = () => {
  useSEO({ 
    title: "Olive — Your AI Note Organizer", 
    description: "Capture, organize, and act on life's notes with AI-powered assistance." 
  });

  const navigate = useLocalizedNavigate();
  const [hasNotes, setHasNotes] = useState(false);
  const [viewMode, setViewMode] = useState<'personal' | 'shared'>('shared'); // Default to shared view
  const { user, loading, isAuthenticated } = useAuth();
  const { currentCouple } = useSupabaseCouple();
  const { notes } = useSupabaseNotesContext();


  // If user is authenticated AND auth has loaded, show enhanced experience
  const isAuthenticatedUser = isAuthenticated && user;
  const userName = isAuthenticatedUser ? (user.firstName || user.fullName || "there") : null;


  // Get filtered notes based on view mode - ALWAYS call this hook
  const filteredNotes = useMemo(() => {
    if (!isAuthenticatedUser) return [];
    
    if (viewMode === 'personal') {
      return notes.filter(note => !note.isShared);
    }
    
    // 'shared' mode shows all notes (personal + shared)
    return notes;
  }, [notes, viewMode, isAuthenticatedUser]);

  // Get organized task sections - ALWAYS call this hook
  const { focusToday, highPriorityTasks, yourFlow, focusScore } = useMemo(() => {
    if (!isAuthenticatedUser || !filteredNotes.length) {
      return { focusToday: [], highPriorityTasks: [], yourFlow: [], focusScore: 0 };
    }

    // Filter out completed tasks for home page display
    const activeTasks = filteredNotes.filter(note => !note.completed);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Focus Today: All tasks due today or overdue
    const todayTasks = activeTasks.filter(note => {
      if (!note.dueDate) return false;
      const dueDate = new Date(note.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate <= today;
    }).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    // High Priority: All high priority tasks not due today
    const highPriority = activeTasks
      .filter(note => {
        if (note.priority !== 'high') return false;
        if (!note.dueDate) return true;
        const dueDate = new Date(note.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate > today;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);

    // Your Flow: Recently created, non-urgent tasks
    const flowTasks = activeTasks
      .filter(note => {
        // Exclude if already in today or high priority
        const isDueToday = note.dueDate && new Date(note.dueDate).setHours(0,0,0,0) <= today.getTime();
        const isHighPriority = note.priority === 'high';
        return !isDueToday && !isHighPriority;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);

    // Focus score: count of tasks due today or overdue
    const score = todayTasks.length;

    return { focusToday: todayTasks, highPriorityTasks: highPriority, yourFlow: flowTasks, focusScore: score };
  }, [filteredNotes, isAuthenticatedUser]);

  // Get time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  // Show loading state while authentication is loading - MOVED AFTER ALL HOOKS
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-olive mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading your space...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <FloatingActionButton />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-8">
          {/* Global Search - Prominent at top for authenticated users */}
          {isAuthenticatedUser && filteredNotes.length > 0 && (
            <UniversalSearch />
          )}
          
          {/* Header */}
          <div className="text-center space-y-4">
            <OliveLogoWithText size="lg" className="justify-center" />
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {isAuthenticatedUser 
                  ? `${getGreeting()}, ${userName}. Ready to tackle the day?` 
                  : "Your AI-powered note organizer"
                }
              </h1>
              <p className="text-muted-foreground">
                {isAuthenticatedUser 
                  ? "What would you like me to organize for you today?"
                  : "Drop a note below and watch Olive organize it for you"
                }
              </p>
            </div>

            {/* Olive Focus Score - show if authenticated and has tasks */}
            {isAuthenticatedUser && filteredNotes.length > 0 && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[hsl(var(--ai-accent))]/10 border border-[hsl(var(--ai-accent))]/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-[hsl(var(--ai-accent))]" />
                <span className="text-sm font-medium text-foreground">
                  Your Day Ahead: <span className="text-[hsl(var(--ai-accent))] font-bold">{focusScore}</span> {focusScore === 1 ? 'Task' : 'Tasks'} Due
                </span>
              </div>
            )}
          </div>

          {/* Context Switcher - only show for authenticated users with a couple */}
          {isAuthenticatedUser && currentCouple && (
            <div className="flex justify-center">
              <div className="inline-flex bg-card border border-border rounded-lg p-1">
                <Button
                  variant={viewMode === 'personal' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('personal')}
                  className={`flex items-center gap-2 ${
                    viewMode === 'personal' 
                      ? 'bg-olive text-white shadow-olive' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <User className="h-4 w-4" />
                  My Notes
                </Button>
                <Button
                  variant={viewMode === 'shared' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('shared')}
                  className={`flex items-center gap-2 ${
                    viewMode === 'shared' 
                      ? 'bg-olive text-white shadow-olive' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Users className="h-4 w-4" />
                  Shared Space
                </Button>
              </div>
            </div>
          )}

          {/* Note Input - use authenticated version if signed in */}
          {isAuthenticatedUser ? (
            <NoteInput onNoteAdded={() => setHasNotes(true)} />
          ) : (
            <SimpleNoteInput onNoteAdded={() => setHasNotes(true)} />
          )}

          {/* Task Sections - only show for authenticated users with notes */}
          {isAuthenticatedUser && filteredNotes.length > 0 && (
            <div className="space-y-6">
              {/* Focus Today Section */}
              <RecentTasksSection
                title="Focus Today"
                tasks={focusToday}
                emptyMessage="No tasks due today"
                icon={<AlertCircle className="h-5 w-5 text-[hsl(var(--ai-accent))]" />}
              />
              
              {/* High Priority Section */}
              <RecentTasksSection
                title="High Priority Tasks"
                tasks={highPriorityTasks}
                emptyMessage="No high priority tasks"
                icon={<AlertCircle className="h-5 w-5 text-[hsl(var(--priority-high))]" />}
              />

              {/* Your Flow Section */}
              <RecentTasksSection
                title="Your Flow"
                tasks={yourFlow}
                emptyMessage="You're all caught up!"
                icon={<Clock className="h-5 w-5 text-olive" />}
              />
            </div>
          )}

          {/* Welcome message */}
          {!hasNotes && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 mx-auto bg-olive/10 rounded-full flex items-center justify-center">
                <Heart className="h-8 w-8 text-olive" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground">
                  Welcome to Olive
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Try adding a note above like "grocery shopping this weekend" and see how I organize it.
                </p>
              </div>
            </div>
          )}

          {/* Features */}
          <div className="flex items-center justify-center gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-olive" />
              {isAuthenticatedUser ? "Saved to your space" : "AI-powered"}
            </div>
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-olive" />
              {isAuthenticatedUser ? "AI-organized" : "Smart categorization"}
            </div>
          </div>

          {/* Auth buttons - only show for non-authenticated users */}
          {!isAuthenticatedUser && (
            <div className="space-y-3 pt-8">
              <p className="text-center text-sm text-muted-foreground">
                Want to save your notes and unlock more features?
              </p>
              <div className="space-y-2">
                <Button 
                  onClick={() => navigate("/sign-up")}
                  className="w-full bg-gradient-olive text-white shadow-olive"
                  size="lg"
                >
                  Create Account
                </Button>
                <Button 
                  onClick={() => navigate("/sign-in")}
                  variant="outline"
                  className="w-full border-olive/30 text-olive hover:bg-olive/10"
                >
                  Sign In
                </Button>
              </div>
            </div>
          )}

          {/* Olive Assistant Branding */}
          <div className="text-center pt-8 pb-4 space-y-2">
            <div className="flex items-center justify-center gap-2">
              <OliveLogoWithText size="sm" className="justify-center" />
            </div>
            <p className="text-xs text-muted-foreground tracking-wide uppercase">
              Olive Assistant — Your AI Chief of Staff
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              With Olive, everything stays organized.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Index;