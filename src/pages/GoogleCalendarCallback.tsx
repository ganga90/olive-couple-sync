import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const GoogleCalendarCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        console.error('OAuth error:', error);
        navigate('/profile?calendar=error&message=' + encodeURIComponent(error));
        return;
      }

      if (!code || !state) {
        navigate('/profile?calendar=error&message=Missing+parameters');
        return;
      }

      try {
        // Call the edge function to exchange the code
        const callbackUrl = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-callback`);
        callbackUrl.searchParams.set('code', code);
        callbackUrl.searchParams.set('state', state);

        // Redirect to edge function which will handle the exchange and redirect back
        window.location.href = callbackUrl.toString();
      } catch (err) {
        console.error('Callback error:', err);
        navigate('/profile?calendar=error&message=Failed+to+connect');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Connecting your Google Calendar...</p>
    </div>
  );
};

export default GoogleCalendarCallback;
