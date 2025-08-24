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
      // NEW APPROACH: Use simple accessToken callback (no template needed)
      accessToken: async () => {
        if (!isSignedIn || !session) {
          console.log('[ClerkAdapter] No Clerk session available');
          return null;
        }
        
        try {
          // Use simple getToken() - no template needed with third-party auth
          const token = await session.getToken();
          console.log('[ClerkAdapter] Got Clerk token for third-party auth:', !!token);
          return token;
        } catch (error) {
          console.error('[ClerkAdapter] Error getting session token:', error);
          return null;
        }
      },
    });
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk third-party auth integration');
    
    return supabaseClient;
  }, [isSignedIn, session]);
};