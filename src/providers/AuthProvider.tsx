import React, { createContext, useContext, useEffect } from "react";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useClerkSupabaseClient } from "@/integrations/supabase/clerk-adapter";

type AuthContextValue = {
  user: any;
  loading: boolean;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoaded } = useUser();
  const { isSignedIn } = useClerkAuth();
  const supabase = useClerkSupabaseClient();

  console.log('[AuthProvider] Clerk state:', { 
    isLoaded, 
    isSignedIn, 
    user: !!user, 
    userId: user?.id
  });

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL LOGIC
  // Sync Clerk user to Supabase profiles when signed in
  useEffect(() => {
    if (isLoaded && isSignedIn && user) {
      console.log('[AuthProvider] Syncing user to Supabase:', user.id);
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
          } else {
            console.log('[Auth] Profile synced successfully for:', user.id);
          }
        } catch (err) {
          console.error('[Auth] Error syncing profile:', err);
        }
      };

      syncProfile();
    }
  }, [isLoaded, isSignedIn, user, supabase]);

  // Calculate auth state
  const isAuthenticated = Boolean(isLoaded && isSignedIn && user);
  const loading = !isLoaded;

  console.log('[AuthProvider] Final auth state:', {
    isAuthenticated,
    loading,
    hasUser: !!user,
    userId: user?.id
  });

  const value = {
    user: isAuthenticated ? user : null,
    loading,
    isAuthenticated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};