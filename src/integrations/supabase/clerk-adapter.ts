import { useAuth, useSession } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Hook to get Clerk-authenticated Supabase client using official integration pattern
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
        },
      },
      // Use accessToken approach to inject Clerk JWT
      accessToken: async () => {
        if (!isSignedIn || !session) {
          console.log('[ClerkAdapter] No Clerk session available');
          return null;
        }
        
        try {
          // Try to get Supabase-specific token first, fallback to regular token
          let token;
          try {
            token = await session.getToken({ template: 'supabase' });
            console.log('[ClerkAdapter] Got Supabase template token:', !!token);
          } catch {
            token = await session.getToken();
            console.log('[ClerkAdapter] Got regular Clerk token:', !!token);
          }
          return token;
        } catch (error) {
          console.error('[ClerkAdapter] Error getting token:', error);
          return null;
        }
      },
    });
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk session token integration');
    
    return supabaseClient;
  }, [isSignedIn, session]);
};