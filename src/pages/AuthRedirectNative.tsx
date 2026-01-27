import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

const AuthRedirectNative = () => {
  useEffect(() => {
    console.log('[AuthRedirectNative] Redirecting to native app...');
    // Small delay to ensure the page renders
    setTimeout(() => {
      window.location.href = 'olive://auth-complete';
    }, 500);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-soft flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="animate-spin h-8 w-8 text-olive mx-auto mb-4" />
        <p className="text-muted-foreground">Returning to app...</p>
      </div>
    </div>
  );
};

export default AuthRedirectNative;
