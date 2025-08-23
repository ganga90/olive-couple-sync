import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/AuthProvider";

const Root = () => {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        navigate("/home");
      } else {
        navigate("/landing");
      }
    }
  }, [isAuthenticated, loading, navigate]);

  // Show loading while determining auth state
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