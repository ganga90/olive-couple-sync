import { useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabaseClient";

const ONBOARDING_COMPLETED_KEY = "olive_onboarding_completed";

const Root = () => {
  const navigate = useLocalizedNavigate();
  const { user, isAuthenticated, loading, clerkTimedOut } = useAuth();
  const isNative = Capacitor.isNativePlatform();
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      if (clerkTimedOut) {
        console.warn('[Root] Clerk timed out — redirecting to landing as fallback');
      }
      if (isNative) {
        navigate("/native-welcome", { replace: true });
      } else {
        navigate("/landing", { replace: true });
      }
      return;
    }

    // User is authenticated — check if they need onboarding
    const checkOnboarding = async () => {
      // Fast path: localStorage says completed
      if (localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true") {
        navigate("/home", { replace: true });
        return;
      }

      setCheckingOnboarding(true);

      try {
        const userId = user?.id;
        if (!userId) {
          navigate("/home", { replace: true });
          return;
        }

        // Check if user has the onboarding_completed memory chunk
        const { data: completionChunk } = await supabase
          .from("olive_memory_chunks")
          .select("id")
          .eq("user_id", userId)
          .eq("chunk_type", "preference")
          .eq("source", "onboarding")
          .limit(1);

        if (completionChunk && completionChunk.length > 0) {
          // Already completed — cache locally and go home
          localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
          navigate("/home", { replace: true });
          return;
        }

        // Check if existing user (has notes or preferences already)
        const { data: existingNotes } = await supabase
          .from("clerk_notes")
          .select("id")
          .eq("author_id", userId)
          .limit(1);

        if (existingNotes && existingNotes.length > 0) {
          // Existing user with data — skip onboarding, mark as completed
          localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
          try {
            await supabase.from("olive_memory_chunks").insert({
              user_id: userId,
              content: "Onboarding skipped (existing user with data)",
              chunk_type: "preference",
              importance: 1,
              source: "onboarding",
              metadata: { type: "onboarding_completed", skipped: true },
            });
          } catch {}
          navigate("/home", { replace: true });
          return;
        }

        // New user with no data — send to onboarding
        navigate("/onboarding", { replace: true });
      } catch (err) {
        console.error("[Root] Error checking onboarding status:", err);
        // On error, default to home
        navigate("/home", { replace: true });
      } finally {
        setCheckingOnboarding(false);
      }
    };

    checkOnboarding();
  }, [isAuthenticated, loading, navigate, isNative, clerkTimedOut, user?.id]);

  return (
    <div className="min-h-screen bg-gradient-soft flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-olive mx-auto mb-4"></div>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
};

export default Root;
