import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { useSpace } from "@/providers/SpaceProvider";
import { getSupabase } from "@/lib/supabaseClient";
import { OliveLogo } from "@/components/OliveLogo";
import { useSEO } from "@/hooks/useSEO";
import { Check, X, Clock, Heart, Users } from "lucide-react";
import { useLocalizedNavigate } from "@/hooks/useLocalizedNavigate";

const AcceptInvite = () => {
  const [searchParams] = useSearchParams();
  const navigate = useLocalizedNavigate();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const { refetch: refetchCouples, switchCouple } = useSupabaseCouple();
  const { acceptInvite: acceptSpaceInvite } = useSpace();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [inviteType, setInviteType] = useState<"couple" | "space">("couple");
  const [error, setError] = useState<string | null>(null);

  useSEO({ title: "Accept Invite — Olive", description: "Join an Olive space." });

  const token = searchParams.get("token");


  useEffect(() => {
    
    if (!token) {
      setError("Invalid invite link");
      setLoading(false);
      return;
    }

    // Wait for auth to finish loading before making decisions
    if (authLoading) {
      return;
    }

    // Only load invite data if user is authenticated
    if (user) {
      loadInvite();
    } else {
      setLoading(false);
    }
  }, [token, user, authLoading]);

  const loadInvite = async () => {
    try {
      const supabase = getSupabase();

      // First, try to find a space invite with this token
      const { data: spaceInviteData, error: spaceError } = await supabase
        .from("olive_space_invites")
        .select("*, olive_spaces(id, name, type, icon)")
        .eq("token", token)
        .eq("status", "pending")
        .maybeSingle();

      if (spaceInviteData && !spaceError) {
        // This is a space invite
        if (new Date(spaceInviteData.expires_at) < new Date()) {
          setError("This invite has expired");
          return;
        }

        setInviteType("space");
        setInvite({
          token: spaceInviteData.token,
          space_id: spaceInviteData.space_id,
          role: spaceInviteData.role,
          space: spaceInviteData.olive_spaces,
          expires_at: spaceInviteData.expires_at,
          invited_email: spaceInviteData.invited_email,
        });
        return;
      }

      // Fall back to existing couple invite flow
      const { data, error } = await supabase.rpc('validate_invite', {
        p_token: token
      });

      if (error) {
        console.error('[AcceptInvite] RPC error:', error);
        setError("Failed to validate invite");
        return;
      }

      const inviteData = Array.isArray(data) ? data[0] : null;

      if (!inviteData) {
        console.error('[AcceptInvite] No invite found');
        setError("Invite not found or expired");
        return;
      }

      if (new Date(inviteData.expires_at) < new Date()) {
        setError("This invite has expired");
        return;
      }

      if (inviteData.accepted) {
        setError("This invite has already been accepted");
        return;
      }

      if (inviteData.revoked) {
        setError("This invite has been revoked");
        return;
      }

      setInviteType("couple");
      const transformedInvite = {
        couple_id: inviteData.couple_id,
        role: inviteData.role,
        clerk_couples: {
          title: inviteData.title,
          you_name: inviteData.you_name,
          partner_name: inviteData.partner_name
        },
        expires_at: inviteData.expires_at
      };
      setInvite(transformedInvite);
    } catch (err) {
      console.error("Failed to load invite:", err);
      setError("Failed to load invite");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvite = async () => {
    if (!user || !invite) return;

    setLoading(true);
    try {
      if (inviteType === "space") {
        // Accept space invite via edge function
        const success = await acceptSpaceInvite(invite.token);
        if (success) {
          navigate("/home");
        }
      } else {
        // Existing couple invite flow
        const supabase = getSupabase();

        const { data: coupleId, error } = await supabase.rpc('accept_invite', {
          p_token: token
        });

        if (error) {
          console.error('Failed to accept invite:', error);

          if (error.message?.includes('INVITE_NOT_FOUND')) {
            toast.error("Invite not found");
          } else if (error.message?.includes('INVITE_EXPIRED')) {
            toast.error("This invite has expired");
          } else if (error.message?.includes('INVITE_ALREADY_ACCEPTED')) {
            toast.error("This invite has already been accepted");
          } else if (error.message?.includes('INVITE_REVOKED')) {
            toast.error("This invite has been revoked");
          } else {
            toast.error("Failed to accept invite. Please try again.");
          }
          return;
        }

        await refetchCouples();

        const { data: joinedCouple, error: fetchError } = await supabase
          .from('clerk_couples')
          .select('*')
          .eq('id', coupleId)
          .single();

        if (fetchError) {
          console.error('Failed to fetch joined couple:', fetchError);
        } else {
          switchCouple(joinedCouple);
        }

        toast.success("Welcome to your shared Olive space!");
        navigate("/home");
      }
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
              onClick={() => navigate("/home")}
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


  const inviteTitle = inviteType === "space"
    ? invite?.space?.name || "a space"
    : invite?.clerk_couples?.title || "a shared space";

  const InviteIcon = inviteType === "space" ? Users : Heart;

  return (
    <main className="min-h-screen bg-gradient-soft">
      <section className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-olive/10 shadow-soft border border-olive/20">
            <InviteIcon className="h-8 w-8 text-olive" />
          </div>
        </div>

        <div className="text-center space-y-4 mb-6">
          <h1 className="text-2xl font-bold text-foreground">You're Invited!</h1>
          <p className="text-muted-foreground">
            Join <strong>{inviteTitle}</strong> on Olive to share notes, lists, and organize your life together.
          </p>
        </div>

        <Card className="p-6 bg-white/50 border-olive/20 shadow-soft space-y-6">
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">
              {inviteType === "space" ? (invite?.space?.type || "Space") : "Couple Space"}
            </h3>
            <p className="text-sm text-muted-foreground">{inviteTitle}</p>
          </div>

          {invite?.invited_email && (
            <div className="space-y-2">
              <h3 className="font-semibold text-foreground">Invited to</h3>
              <p className="text-sm text-muted-foreground">{invite.invited_email}</p>
            </div>
          )}

          {invite?.expires_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Expires {new Date(invite.expires_at).toLocaleDateString()}
            </div>
          )}

          <Button
            onClick={handleAcceptInvite}
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