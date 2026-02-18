import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const OuraCallback = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        console.error('Oura OAuth error:', error);
        navigate('/profile?oura=error&message=' + encodeURIComponent(error));
        return;
      }

      if (!code || !state) {
        navigate('/profile?oura=error&message=Missing+parameters');
        return;
      }

      try {
        // Redirect to edge function which handles the exchange
        const callbackUrl = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oura-callback`);
        callbackUrl.searchParams.set('code', code);
        callbackUrl.searchParams.set('state', state);
        window.location.href = callbackUrl.toString();
      } catch (err) {
        console.error('Oura callback error:', err);
        navigate('/profile?oura=error&message=Failed+to+connect');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Connecting your Oura Ring...</p>
    </div>
  );
};

export default OuraCallback;
