import { useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";
import { Capacitor } from "@capacitor/core";

const Root = () => {
  const navigate = useLocalizedNavigate();
  const { isAuthenticated, loading } = useAuth();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        navigate("/home", { replace: true });
      } else {
        // Native iOS/Android app gets the native welcome screen
        // Web users get the full landing page
        if (isNative) {
          navigate("/native-welcome", { replace: true });
        } else {
          navigate("/landing", { replace: true });
        }
      }
    }
  }, [isAuthenticated, loading, navigate, isNative]);

  // Show loading state while determining redirect
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