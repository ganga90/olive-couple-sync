import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { getSupabase } from "@/lib/supabaseClient";
import { OliveLogo } from "@/components/OliveLogo";
import { useSEO } from "@/hooks/useSEO";
import { Check, X, Clock, Heart } from "lucide-react";

const AcceptInvite = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const { refetch: refetchCouples, switchCouple } = useSupabaseCouple();
  
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  useSEO({ title: "Accept Invite — Olive", description: "Join your partner's Olive space." });

  const token = searchParams.get("token");

  // Debug authentication state
  console.log('[AcceptInvite] Auth state:', { 
    user: !!user, 
    authLoading, 
    isAuthenticated, 
    token 
  });

  useEffect(() => {
    console.log('[AcceptInvite] useEffect triggered:', { token, user: !!user, authLoading });
    
    if (!token) {
      setError("Invalid invite link");
      setLoading(false);
      return;
    }

    // Wait for auth to finish loading before making decisions
    if (authLoading) {
      console.log('[AcceptInvite] Auth still loading, waiting...');
      return;
    }

    // Only load invite data if user is authenticated
    if (user) {
      console.log('[AcceptInvite] User found, loading invite data');
      loadInvite();
    } else {
      console.log('[AcceptInvite] No user, showing sign-in prompt');
      setLoading(false);
    }
  }, [token, user, authLoading]);

  const loadInvite = async () => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("clerk_invites")
        .select(`
          *,
          clerk_couples!inner(*)
        `)
        .eq("token", token)
        .single();

      if (error || !data) {
        setError("Invite not found or expired");
        return;
      }

      // Check if invite is expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setError("This invite has expired");
        return;
      }

      // Check if already accepted
      if (data.status === "accepted") {
        setError("This invite has already been accepted");
        return;
      }

      setInvite(data);
    } catch (err) {
      console.error("Failed to load invite:", err);
      setError("Failed to load invite");
    } finally {
      setLoading(false);
    }
  };

  const acceptInvite = async () => {
    if (!user || !invite) return;

    setLoading(true);
    try {
      const supabase = getSupabase();
      // Use the new atomic RPC function for accepting invites
      const { data: coupleId, error } = await supabase.rpc('accept_invite', {
        p_token: token
      });

      if (error) {
        throw error;
      }

      console.log('Invite accepted successfully, couple ID:', coupleId);
      
      // Refresh couples list to include the new shared space
      await refetchCouples();
      
      // Fetch the specific couple that was just joined and set it as current
      const { data: joinedCouple, error: fetchError } = await supabase
        .from('clerk_couples')
        .select('*')
        .eq('id', coupleId)
        .single();
      
      if (fetchError) {
        console.error('Failed to fetch joined couple:', fetchError);
      } else {
        // Switch to the shared space that was just joined
        switchCouple(joinedCouple);
        console.log('Switched to joined couple:', joinedCouple);
      }
      
      toast.success("Welcome to your shared Olive space!");
      navigate("/");
    } catch (error) {
      console.error("Failed to accept invite:", error);
      toast.error("Failed to accept invite. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Show loading if auth is loading OR component is loading
  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-gradient-soft flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20 mb-4">
            <OliveLogo size={32} />
          </div>
          <p className="text-muted-foreground">Loading invite...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <section className="mx-auto max-w-md px-4 py-10">
          <div className="mb-6 flex justify-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 shadow-soft border border-red-200">
              <X className="h-8 w-8 text-red-600" />
            </div>
          </div>
          
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-foreground">Invite Issue</h1>
            <p className="text-muted-foreground">{error}</p>
            
            <Button 
              onClick={() => navigate("/")}
              variant="outline"
              className="border-olive/30 text-olive hover:bg-olive/10"
            >
              Go to Olive
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-gradient-soft">
        <section className="mx-auto max-w-md px-4 py-10">
          <div className="mb-6 flex justify-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
              <OliveLogo size={32} />
            </div>
          </div>
          
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-foreground">Almost there!</h1>
            <p className="text-muted-foreground">
              Sign in to accept this invite and join your partner's Olive space.
            </p>
            
            <div className="space-y-3">
              <Button 
                onClick={() => navigate(`/sign-in?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`)}
                className="w-full bg-olive hover:bg-olive/90 text-white"
              >
                Sign In
              </Button>
              <Button 
                onClick={() => navigate(`/sign-up?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`)}
                variant="outline"
                className="w-full border-olive/30 text-olive hover:bg-olive/10"
              >
                Create Account
              </Button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <Heart className="h-8 w-8 text-olive" />
          </div>
        </div>
        
        <div className="text-center space-y-4 mb-6">
          <h1 className="text-2xl font-bold text-foreground">You're Invited!</h1>
          <p className="text-muted-foreground">
            Join <strong>{invite.clerk_couples.title}</strong> on Olive to share notes, lists, and organize your life together.
          </p>
        </div>

        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Couple Space</h3>
            <p className="text-sm text-muted-foreground">{invite.clerk_couples.title}</p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Invited to</h3>
            <p className="text-sm text-muted-foreground">{invite.invited_email}</p>
          </div>

          {invite.expires_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Expires {new Date(invite.expires_at).toLocaleDateString()}
            </div>
          )}

          <Button 
            onClick={acceptInvite}
            className="w-full bg-olive hover:bg-olive/90 text-white shadow-soft"
            disabled={loading}
          >
            {loading ? "Joining..." : "Accept Invite"}
          </Button>
        </Card>
      </section>
    </main>
  );
};

export default AcceptInvite;