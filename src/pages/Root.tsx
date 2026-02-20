import { useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Capacitor } from "@capacitor/core";

const Root = () => {
  const navigate = useLocalizedNavigate();
  const { isAuthenticated, loading, clerkTimedOut } = useAuth();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        navigate("/home", { replace: true });
      } else {
        if (clerkTimedOut) {
          console.warn('[Root] Clerk timed out — redirecting to landing as fallback');
        }
        if (isNative) {
          navigate("/native-welcome", { replace: true });
        } else {
          navigate("/landing", { replace: true });
        }
      }
    }
  }, [isAuthenticated, loading, navigate, isNative, clerkTimedOut]);

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