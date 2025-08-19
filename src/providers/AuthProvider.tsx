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

  console.log('[AuthProvider] Raw Clerk hooks:', { 
    isLoaded, 
    isSignedIn, 
    user: !!user, 
    userId: user?.id
  });

  // Wait for Clerk to load before doing anything
  if (!isLoaded) {
    console.log('[AuthProvider] Clerk still loading...');
    return (
      <AuthContext.Provider value={{
        user: null,
        loading: true,
        isAuthenticated: false,
      }}>
        {children}
      </AuthContext.Provider>
    );
  }

  console.log('[AuthProvider] Clerk loaded! Final state:', {
    isSignedIn,
    user: !!user,
    userId: user?.id
  });

  // Sync Clerk user to Supabase profiles when signed in
  useEffect(() => {
    if (isSignedIn && user) {
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
  }, [isSignedIn, user, supabase]);

  // Now we know Clerk is loaded, calculate the auth state
  const isAuthenticated = Boolean(isSignedIn && user);
  
  console.log('[AuthProvider] Final authenticated state:', {
    isAuthenticated,
    hasUser: !!user,
    userId: user?.id
  });

  const value = {
    user: isAuthenticated ? user : null,
    loading: false, // Clerk is loaded at this point
    isAuthenticated,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};