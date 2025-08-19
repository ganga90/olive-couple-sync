import React, { createContext, useContext, useEffect, useState } from "react";
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
  const [initialized, setInitialized] = useState(false);
  const supabase = useClerkSupabaseClient();

  // Add debugging to track Clerk initialization
  console.log('[AuthProvider] Raw Clerk State:', { 
    isLoaded, 
    isSignedIn, 
    user: !!user, 
    userId: user?.id,
    userEmail: user?.emailAddresses?.[0]?.emailAddress,
    fullName: user?.fullName,
    initialized
  });

  // Wait for Clerk to fully initialize
  useEffect(() => {
    if (isLoaded && !initialized) {
      console.log('[AuthProvider] Clerk has loaded, setting initialized to true');
      setInitialized(true);
    }
  }, [isLoaded, initialized]);

  // Sync Clerk user to Supabase profiles
  useEffect(() => {
    if (isSignedIn && user && isLoaded && initialized) {
      console.log('[AuthProvider] Syncing user profile to Supabase:', user.id);
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
            console.log('[Auth] Profile synced successfully');
          }
        } catch (err) {
          console.error('[Auth] Error syncing profile:', err);
        }
      };

      syncProfile();
    }
  }, [isSignedIn, user, isLoaded, initialized, supabase]);

  // Calculate authentication state - must be loaded AND initialized
  const isAuthenticated = Boolean(isSignedIn && user && isLoaded && initialized);
  const loading = !isLoaded || !initialized;
  
  console.log('[AuthProvider] Computing authentication:', {
    isSignedIn,
    hasUser: !!user,
    isLoaded,
    initialized,
    computed: isAuthenticated,
    loading
  });

  const value = {
    user: isAuthenticated ? user : null,
    loading,
    isAuthenticated,
  };

  console.log('[AuthProvider] Final context value:', {
    hasUser: !!value.user,
    loading: value.loading,
    isAuthenticated: value.isAuthenticated
  });

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};