import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { NoteInput } from "@/components/NoteInput";
import { NoteCard } from "@/components/NoteCard";
import { CategoryList } from "@/components/CategoryList";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Button } from "@/components/ui/button";
import { Plus, List, Heart } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { FloatingNoteButton } from "@/components/FloatingNoteButton";

const Index = () => {
  useSEO({ 
    title: "Olive — Your Couple's Second Brain", 
    description: "Capture, organize, and act on life's notes, tasks, and ideas together with AI-powered assistance." 
  });

  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { currentCouple, isOnboarded, loading: coupleLoading } = useSupabaseCouple();
  const { notes, loading: notesLoading } = useSupabaseNotesContext();

  console.log('[Index] Auth state:', { user: !!user, authLoading, isOnboarded, coupleLoading, currentCouple: !!currentCouple });

  // Show loading state only when auth is actually loading
  if (authLoading) {
    console.log('[Index] Showing loading state - authLoading:', authLoading);
    return (
      <main className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <div className="text-center">
          <OliveLogoWithText size="lg" className="mb-4" />
          <p className="text-muted-foreground">Loading your space...</p>
        </div>
      </main>
    );
  }

  // Add timeout fallback to prevent infinite loading
  React.useEffect(() => {
    const timeout = setTimeout(() => {
      if (authLoading) {
        console.warn('[Index] Auth loading timeout - forcing completion');
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [authLoading]);

  // Redirect to auth if not signed in
  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto text-center space-y-6">
            <OliveLogoWithText size="lg" className="justify-center" />
            
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-foreground">
                Your couple's second brain
              </h1>
              <p className="text-muted-foreground">
                Capture, organize, and act on life's notes, tasks, and ideas together with AI-powered assistance.
              </p>
            </div>

            <div className="space-y-3">
              <Button 
                onClick={() => navigate("/sign-up")}
                className="w-full bg-gradient-olive text-white shadow-olive"
                size="lg"
              >
                Get Started
              </Button>
              <Button 
                onClick={() => navigate("/sign-in")}
                variant="outline"
                className="w-full border-olive/30 text-olive hover:bg-olive/10"
                size="lg"
              >
                Sign In
              </Button>
            </div>

            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Heart className="h-4 w-4 text-olive" />
                Built for couples
              </div>
              <div className="flex items-center gap-1">
                <Plus className="h-4 w-4 text-olive" />
                AI-powered
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // If user is signed in but no couple setup yet, show simple onboarding option
  if (!currentCouple && !coupleLoading) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto text-center space-y-6">
            <OliveLogoWithText size="lg" className="justify-center" />
            
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-foreground">
                Welcome to Olive!
              </h1>
              <p className="text-muted-foreground">
                Your couple's shared second brain is ready. Start by adding your first note below!
              </p>
            </div>

            {/* Show note input immediately */}
            <div className="max-w-lg mx-auto">
              <NoteInput />
            </div>

            <Button 
              onClick={() => navigate("/onboarding")}
              variant="outline"
              className="border-olive/30 text-olive hover:bg-olive/10"
              size="sm"
            >
              Set up couple names (optional)
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Get recent notes (last 5)
  const recentNotes = notes.slice(0, 5);
  
  // Get unique categories
  const categories = Array.from(new Set(notes.map(note => note.category)))
    .filter(category => category && category !== "general");

  return (
    <main className="min-h-screen bg-gradient-soft pb-20">
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <OliveLogoWithText className="justify-center" />
          <p className="text-sm text-muted-foreground">
            Your shared second brain
          </p>
        </div>

        {/* Note Input */}
        <div className="max-w-lg mx-auto">
          <NoteInput />
        </div>

        {/* Quick Lists Access */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              Your Lists
            </h2>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate("/lists")}
              className="text-olive hover:text-olive-dark hover:bg-olive/10"
            >
              <List className="h-4 w-4 mr-1" />
              View All
            </Button>
          </div>

          <div className="grid gap-3">
            {categories.slice(0, 4).map((category) => (
              <CategoryList
                key={category}
                title={category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                category={category}
                shared={true}
              />
            ))}
          </div>
        </div>

        {/* Recent Notes */}
        {recentNotes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">
              Recent Notes
            </h2>
            
            <div className="space-y-3">
              {recentNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {notes.length === 0 && !notesLoading && (
          <div className="text-center py-12 space-y-4">
            <div className="w-16 h-16 mx-auto bg-olive/10 rounded-full flex items-center justify-center">
              <Heart className="h-8 w-8 text-olive" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                Start your journey together
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Drop your first note above and watch Olive organize it for you both.
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Floating Note Button */}
      <FloatingNoteButton />
    </main>
  );
};

export default Index;