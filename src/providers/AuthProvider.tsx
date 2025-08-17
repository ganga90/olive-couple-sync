import React, { createContext, useContext, useEffect } from "react";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";

type AuthContextValue = {
  user: any;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoaded } = useUser();
  const { isSignedIn } = useClerkAuth();
  const supabase = useClerkSupabaseClient();

  // Sync Clerk user to Supabase profiles
  useEffect(() => {
    if (isSignedIn && user && isLoaded) {
      const syncProfile = async () => {
        try {
          const { error } = await supabase
            .from('clerk_profiles')
            .upsert([{ 
              id: user.id,
              display_name: user.fullName || user.firstName || user.emailAddresses[0]?.emailAddress?.split('@')[0] || 'User'
            }], {
              onConflict: 'id'
            });
          
          if (error) {
            console.error('[Auth] Error syncing profile:', error);
          }
        } catch (err) {
          console.error('[Auth] Error syncing profile:', err);
        }
      };

      syncProfile();
    }
  }, [isSignedIn, user, isLoaded, supabase]);

  const value = {
    user: isSignedIn ? user : null,
    loading: !isLoaded,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};