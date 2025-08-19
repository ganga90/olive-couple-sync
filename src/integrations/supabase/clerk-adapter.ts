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
        
        // Use ONLY the regular session token for direct Clerk-Supabase integration
        const sessionToken = await getToken();
        console.log('[ClerkAdapter] Session token available:', !!sessionToken);
        
        const tokenToUse = sessionToken;
        
        if (tokenToUse) {
          console.log('[ClerkAdapter] Using regular session token for direct integration');
          console.log('[ClerkAdapter] Setting Supabase session with token');
          
          const { data, error } = await supabaseClient.auth.setSession({
            access_token: tokenToUse,
            refresh_token: tokenToUse
          });
          
          if (error) {
            console.error('[ClerkAdapter] Error setting session:', error);
          } else {
            console.log('[ClerkAdapter] Session set successfully:', data);
            
            // Verify auth.uid() works
            try {
              const { data: user } = await supabaseClient.auth.getUser();
              console.log('[ClerkAdapter] Current Supabase user:', user);
            } catch (err) {
              console.error('[ClerkAdapter] Error testing auth:', err);
            }
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
          
          // Use only the regular session token for direct integration
          const sessionToken = await getToken();
          console.log('[ClerkAdapter] Function token available:', !!sessionToken);
          
          if (sessionToken) {
            console.log('[ClerkAdapter] Setting session before function call');
            const { error: sessionError } = await supabaseClient.auth.setSession({
              access_token: sessionToken,
              refresh_token: sessionToken
            });
            
            if (sessionError) {
              console.error('[ClerkAdapter] Session error before function call:', sessionError);
            }
          }
          
          const headers = {
            ...options?.headers,
            ...(sessionToken && { Authorization: `Bearer ${sessionToken}` })
          };

          console.log('[ClerkAdapter] Calling function with headers:', Object.keys(headers));
          
          const result = await supabaseClient.functions.invoke(functionName, {
            ...options,
            headers
          });
          
          console.log('[ClerkAdapter] Function result:', result);
          return result;
        }
      }
    };
  }, [getToken]);
};