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
  const supabase = useClerkSupabaseClient();

  // Simplify: Just use Clerk's built-in state management
  console.log('[AuthProvider] Clerk State:', { 
    isLoaded, 
    isSignedIn, 
    user: !!user, 
    userId: user?.id,
    userEmail: user?.emailAddresses?.[0]?.emailAddress,
    fullName: user?.fullName
  });

  // Sync Clerk user to Supabase profiles
  useEffect(() => {
    if (isSignedIn && user && isLoaded) {
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
            console.log('[Auth] Profile synced successfully for:', user.id);
          }
        } catch (err) {
          console.error('[Auth] Error syncing profile:', err);
        }
      };

      syncProfile();
    }
  }, [isSignedIn, user, isLoaded, supabase]);

  // Calculate authentication state based on Clerk's state
  const isAuthenticated = Boolean(isSignedIn && user && isLoaded);
  const loading = !isLoaded;
  
  console.log('[AuthProvider] Authentication computed:', {
    isSignedIn: !!isSignedIn,
    hasUser: !!user,
    isLoaded,
    isAuthenticated,
    loading
  });

  const value = {
    user: isAuthenticated ? user : null,
    loading,
    isAuthenticated,
  };

  console.log('[AuthProvider] FINAL AUTH STATE:', {
    hasUser: !!value.user,
    userId: value.user?.id,
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