import { useAuth } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Hook to get Clerk-authenticated Supabase client using official integration pattern
export const useClerkSupabaseClient = () => {
  const { getToken, isSignedIn } = useAuth();
  
  return useMemo(() => {
    // Create Supabase client with Clerk session token using official pattern
    const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      global: {
        async accessToken() {
          if (!isSignedIn) {
            console.log('[ClerkAdapter] User not signed in, no token');
            return null;
          }
          
          const token = await getToken();
          console.log('[ClerkAdapter] Got Clerk token for Supabase:', !!token);
          return token;
        },
      },
    });
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk token injection');
    
    return supabaseClient;
  }, [getToken, isSignedIn]);
};