import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const OuraCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Safety timeout — if redirect hasn't happened in 15s, show manual retry
    const timeout = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        console.error('Oura OAuth error:', error);
        navigate('/profile?oura=error&message=' + encodeURIComponent(error), { replace: true });
        return;
      }

      if (!code || !state) {
        navigate('/profile?oura=error&message=Missing+parameters', { replace: true });
        return;
      }

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Configuration error');
        }

        // Redirect to edge function which handles the token exchange
        const callbackUrl = new URL(`${supabaseUrl}/functions/v1/oura-callback`);
        callbackUrl.searchParams.set('code', code);
        callbackUrl.searchParams.set('state', state);
        window.location.href = callbackUrl.toString();
      } catch (err) {
        console.error('Oura callback error:', err);
        navigate('/profile?oura=error&message=Failed+to+connect', { replace: true });
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  if (timedOut) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-muted-foreground text-center">
          The connection is taking longer than expected.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/profile', { replace: true })}>
            Go to Profile
          </Button>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Connecting your Oura Ring...</p>
    </div>
  );
};

export default OuraCallback;
