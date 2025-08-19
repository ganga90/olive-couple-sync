import { useAuth } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useEffect, useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Create Supabase client
const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Hook to get Clerk-authenticated Supabase client
export const useClerkSupabaseClient = () => {
  const { getToken, isSignedIn } = useAuth();
  
  // Set auth token whenever user signs in
  useEffect(() => {
    const setAuthToken = async () => {
      if (isSignedIn) {
        console.log('[ClerkAdapter] User signed in, setting auth token');
        // Use Clerk session token directly (no template needed for new integration)
        const token = await getToken();
        console.log('[ClerkAdapter] Got Clerk token:', !!token);
        
        if (token) {
          console.log('[ClerkAdapter] Setting Supabase session with Clerk token');
          // Set the session with the Clerk token
          const { error } = await supabaseClient.auth.setSession({
            access_token: token,
            refresh_token: token
          });
          
          if (error) {
            console.error('[ClerkAdapter] Error setting session:', error);
          } else {
            console.log('[ClerkAdapter] Session set successfully');
          }
        }
      } else {
        console.log('[ClerkAdapter] User signed out, clearing session');
        await supabaseClient.auth.signOut();
      }
    };

    setAuthToken();
  }, [isSignedIn, getToken]);
  
  return useMemo(() => {
    return {
      ...supabaseClient,
      // Keep all original methods and properties
      from: supabaseClient.from.bind(supabaseClient),
      channel: supabaseClient.channel.bind(supabaseClient),
      removeChannel: supabaseClient.removeChannel.bind(supabaseClient),
      rpc: supabaseClient.rpc.bind(supabaseClient),
      auth: supabaseClient.auth,
      storage: supabaseClient.storage,
      realtime: supabaseClient.realtime,
      functions: {
        ...supabaseClient.functions,
        invoke: async (functionName: string, options?: any) => {
          console.log('[ClerkAdapter] Invoking function:', functionName);
          
          // Always get a fresh token for function calls (no template needed)
          const token = await getToken();
          console.log('[ClerkAdapter] Function token present:', !!token);
          
          if (token) {
            // Ensure session is set before function call
            await supabaseClient.auth.setSession({
              access_token: token,
              refresh_token: token
            });
          }
          
          const headers = {
            ...options?.headers,
            ...(token && { Authorization: `Bearer ${token}` })
          };

          return supabaseClient.functions.invoke(functionName, {
            ...options,
            headers
          });
        }
      }
    };
  }, [getToken]);
};