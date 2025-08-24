import { useAuth, useSession } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Hook to get Clerk-authenticated Supabase client using NEW Third-Party Auth integration
export const useClerkSupabaseClient = () => {
  const { isSignedIn } = useAuth();
  const { session } = useSession();
  
  return useMemo(() => {
    const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
      },
      global: {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Prefer': 'return=representation',
        },
      },
      // Use Supabase JWT template for proper RLS integration
      accessToken: async () => {
        if (!isSignedIn || !session) {
          console.log('[ClerkAdapter] No Clerk session available');
          return null;
        }
        
        try {
          // Use Supabase JWT template - this creates JWT with proper 'sub' claim
          const token = await session.getToken({ template: 'supabase' });
          console.log('[ClerkAdapter] Got Clerk Supabase JWT token:', !!token);
          if (token) {
            console.log('[ClerkAdapter] JWT token preview:', token.substring(0, 100) + '...');
          }
          return token;
        } catch (error) {
          console.error('[ClerkAdapter] Error getting Supabase JWT token:', error);
          // Fallback to regular token if Supabase template fails
          console.log('[ClerkAdapter] Falling back to regular token...');
          try {
            const fallbackToken = await session.getToken();
            console.log('[ClerkAdapter] Got fallback token:', !!fallbackToken);
            return fallbackToken;
          } catch (fallbackError) {
            console.error('[ClerkAdapter] Fallback token also failed:', fallbackError);
            return null;
          }
        }
      },
    });
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk Third-Party Auth integration');
    
    return supabaseClient;
  }, [isSignedIn, session]);
};