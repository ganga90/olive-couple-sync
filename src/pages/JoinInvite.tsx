import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

const JoinInvite = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      // Redirect to the accept invite page with the token
      navigate(`/accept-invite?token=${token}`, { replace: true });
    } else {
      // No token, redirect to home
      navigate("/", { replace: true });
    }
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-gradient-soft flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-olive mx-auto mb-4"></div>
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
};

export default JoinInvite;