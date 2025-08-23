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
    // Create Supabase client with Clerk session token
    const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          'Content-Type': 'application/json',
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      // Use Clerk session token for authentication
      accessToken: async () => {
        if (!isSignedIn || !session) {
          console.log('[ClerkAdapter] No Clerk session available');
          return null;
        }
        
        try {
          // Use the supabase template to get the proper JWT format
          const token = await session.getToken({ template: "supabase" });
          console.log('[ClerkAdapter] Got Clerk token for Supabase:', !!token);
          return token;
        } catch (error) {
          console.warn('[ClerkAdapter] Failed to get Supabase token:', error);
          return null;
        }
      },
    });
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk session token integration');
    
    return supabaseClient;
  }, [isSignedIn, session]);
};