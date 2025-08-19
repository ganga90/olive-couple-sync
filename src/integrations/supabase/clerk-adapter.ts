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
        const token = await getToken({ template: "supabase" });
        console.log('[ClerkAdapter] Got Clerk token:', !!token, token ? token.substring(0, 50) + '...' : 'NO TOKEN');
        
        // Decode and log JWT payload for debugging
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            console.log('[ClerkAdapter] JWT payload:', payload);
          } catch (e) {
            console.error('[ClerkAdapter] Failed to decode JWT:', e);
          }
        }
        
        if (token) {
          console.log('[ClerkAdapter] Setting Supabase session with token');
          // Set the session with the Clerk JWT token
          const { error } = await supabaseClient.auth.setSession({
            access_token: token,
            refresh_token: ''
          });
          
          if (error) {
            console.error('[ClerkAdapter] Error setting session:', error);
          } else {
            console.log('[ClerkAdapter] Session set successfully');
          }
          
          // Test the JWT function to see what user ID we get
          try {
            const { data: debugClaims } = await supabaseClient.rpc('debug_jwt_claims');
            console.log('[ClerkAdapter] JWT claims debug:', debugClaims);
            
            const { data: userId, error: userError } = await supabaseClient.rpc('get_clerk_user_id');
            console.log('[ClerkAdapter] get_clerk_user_id result:', { userId, error: userError });
          } catch (err) {
            console.log('[ClerkAdapter] Error testing JWT functions:', err);
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
          
          // Always get a fresh token for function calls
          const token = await getToken({ template: "supabase" });
          console.log('[ClerkAdapter] Function token present:', !!token);
          
          if (token) {
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              console.log('[ClerkAdapter] Function call JWT payload:', payload);
            } catch (e) {
              console.error('[ClerkAdapter] Failed to decode function JWT:', e);
            }
          }
          
          if (token) {
            // Ensure session is set before function call
            await supabaseClient.auth.setSession({
              access_token: token,
              refresh_token: ''
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