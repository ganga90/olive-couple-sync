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
    });
    
    // Set the session with Supabase JWT token from Clerk if user is signed in
    const setSupabaseSession = async () => {
      if (!isSignedIn || !session) {
        console.log('[ClerkAdapter] No Clerk session available, clearing Supabase session');
        await supabaseClient.auth.signOut();
        return;
      }
      
      try {
        // First try to get the Supabase JWT token specifically from Clerk
        let supabaseToken;
        try {
          supabaseToken = await session.getToken({ template: 'supabase' });
          console.log('[ClerkAdapter] Got Supabase JWT token:', !!supabaseToken);
        } catch (templateError) {
          // Fallback to regular token if template doesn't exist
          console.log('[ClerkAdapter] Supabase template not found, using regular token');
          supabaseToken = await session.getToken();
        }
        
        if (supabaseToken) {
          // Set the session using the JWT token
          await supabaseClient.auth.setSession({
            access_token: supabaseToken,
            refresh_token: 'placeholder', // Required but not used
          });
          console.log('[ClerkAdapter] Successfully set Supabase session with Clerk token');
        }
      } catch (error) {
        console.error('[ClerkAdapter] Error setting Supabase session:', error);
      }
    };
    
    // Set session immediately
    setSupabaseSession();
    
    console.log('[ClerkAdapter] Created Supabase client with Clerk session token integration');
    
    return supabaseClient;
  }, [isSignedIn, session]);
};