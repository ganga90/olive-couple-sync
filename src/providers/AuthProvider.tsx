import React, { createContext, useContext, useEffect, useState } from "react";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { supabase, setClerkTokenGetter } from "@/lib/supabaseClient";

type AuthContextValue = {
  user: any;
  loading: boolean;
  isAuthenticated: boolean;
  clerkTimedOut: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CLERK_LOAD_TIMEOUT_MS = 6000; // 6 seconds max wait for Clerk

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoaded } = useUser();
  const { getToken, isSignedIn } = useClerkAuth();
  const [clerkTimedOut, setClerkTimedOut] = useState(false);

  // Timeout: if Clerk doesn't load within 6s, stop blocking the app
  useEffect(() => {
    if (isLoaded) return; // Already loaded, no timeout needed
    const timer = setTimeout(() => {
      if (!isLoaded) {
        console.warn('[AuthProvider] Clerk failed to load within timeout — falling back to unauthenticated state');
        setClerkTimedOut(true);
      }
    }, CLERK_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  // Clear timeout flag if Clerk eventually loads
  useEffect(() => {
    if (isLoaded && clerkTimedOut) {
      setClerkTimedOut(false);
    }
  }, [isLoaded, clerkTimedOut]);

  // Make the token getter available to the singleton client
  useEffect(() => {
    console.log('[AuthProvider] Setting token getter, getToken function:', typeof getToken)
    const tokenGetterWrapper = async () => {
      try {
        const token = await getToken({ template: 'supabase' })
        if (token) {
          try {
            const alg = JSON.parse(atob(token.split('.')[0])).alg;
            console.log('[Auth] Supabase token alg:', alg);
          } catch (e) {
            console.error('[Auth] Could not parse token header:', e);
          }
        }
        return token
      } catch (error) {
        console.error('[AuthProvider] Error getting token:', error)
        return null
      }
    }
    setClerkTokenGetter(tokenGetterWrapper)
  }, [getToken]);

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
          if (error) console.error('[Auth] Error syncing profile:', error);
        } catch (err) {
          console.error('[Auth] Error syncing profile:', err);
        }
      };
      syncProfile();
    }
  }, [isLoaded, isSignedIn, user]);

  // Calculate auth state — if timed out, treat as "not loading, not authenticated"
  const effectivelyLoaded = isLoaded || clerkTimedOut;
  const isAuthenticated = Boolean(isLoaded && isSignedIn && user);
  const loading = !effectivelyLoaded;

  const value = {
    user: isAuthenticated ? user : null,
    loading,
    isAuthenticated,
    clerkTimedOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};