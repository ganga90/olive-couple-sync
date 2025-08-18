import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { OliveLogoWithText } from "@/components/OliveLogo";
import { Button } from "@/components/ui/button";
import { Plus, Heart } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { SimpleNoteInput } from "@/components/SimpleNoteInput";

const Index = () => {
  useSEO({ 
    title: "Olive — Your AI Note Organizer", 
    description: "Capture, organize, and act on life's notes with AI-powered assistance." 
  });

  const navigate = useNavigate();
  const [hasNotes, setHasNotes] = useState(false);

  // Simple standalone interface - no authentication required
  return (
    <main className="min-h-screen bg-gradient-soft">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <OliveLogoWithText size="lg" className="justify-center" />
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                Your AI-powered note organizer
              </h1>
              <p className="text-muted-foreground">
                Drop a note below and watch Olive organize it for you
              </p>
            </div>
          </div>

          {/* Note Input */}
          <SimpleNoteInput onNoteAdded={() => setHasNotes(true)} />

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
              AI-powered
            </div>
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-olive" />
              Smart categorization
            </div>
          </div>

          {/* Auth buttons */}
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
        </div>
      </div>
    </main>
  );
};

export default Index;