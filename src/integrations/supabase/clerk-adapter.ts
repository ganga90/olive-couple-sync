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
        
        // Try both approaches to debug which works
        console.log('[ClerkAdapter] Testing token methods...');
        
        // Test 1: Regular token
        const regularToken = await getToken();
        console.log('[ClerkAdapter] Regular token:', !!regularToken, regularToken?.substring(0, 30) + '...');
        
        // Test 2: Supabase template token  
        const supabaseToken = await getToken({ template: "supabase" });
        console.log('[ClerkAdapter] Supabase template token:', !!supabaseToken, supabaseToken?.substring(0, 30) + '...');
        
        // Decode and inspect both tokens
        if (regularToken) {
          try {
            const payload = JSON.parse(atob(regularToken.split('.')[1]));
            console.log('[ClerkAdapter] Regular token payload:', payload);
          } catch (e) {
            console.error('[ClerkAdapter] Failed to decode regular token:', e);
          }
        }
        
        if (supabaseToken) {
          try {
            const payload = JSON.parse(atob(supabaseToken.split('.')[1]));
            console.log('[ClerkAdapter] Supabase token payload:', payload);
          } catch (e) {
            console.error('[ClerkAdapter] Failed to decode Supabase token:', e);
          }
        }
        
        // Try using the Supabase template token first
        const tokenToUse = supabaseToken || regularToken;
        
        if (tokenToUse) {
          console.log('[ClerkAdapter] Using token type:', supabaseToken ? 'supabase-template' : 'regular');
          console.log('[ClerkAdapter] Setting Supabase session with token');
          
          const { data, error } = await supabaseClient.auth.setSession({
            access_token: tokenToUse,
            refresh_token: tokenToUse
          });
          
          if (error) {
            console.error('[ClerkAdapter] Error setting session:', error);
          } else {
            console.log('[ClerkAdapter] Session set successfully:', data);
            
            // Test if auth.uid() works
            try {
              const { data: user } = await supabaseClient.auth.getUser();
              console.log('[ClerkAdapter] Current Supabase user:', user);
              
              // Test a simple authenticated query
              const { data: testData, error: testError } = await supabaseClient
                .from('clerk_profiles')
                .select('*')
                .limit(1);
              console.log('[ClerkAdapter] Test query result:', { testData, testError });
              
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
          
          // Try both token types for function calls
          const regularToken = await getToken();
          const supabaseToken = await getToken({ template: "supabase" });
          const tokenToUse = supabaseToken || regularToken;
          
          console.log('[ClerkAdapter] Function token types:', {
            regular: !!regularToken,
            supabase: !!supabaseToken,
            using: supabaseToken ? 'supabase-template' : 'regular'
          });
          
          if (tokenToUse) {
            console.log('[ClerkAdapter] Setting session before function call');
            const { error: sessionError } = await supabaseClient.auth.setSession({
              access_token: tokenToUse,
              refresh_token: tokenToUse
            });
            
            if (sessionError) {
              console.error('[ClerkAdapter] Session error before function call:', sessionError);
            }
          }
          
          const headers = {
            ...options?.headers,
            ...(tokenToUse && { Authorization: `Bearer ${tokenToUse}` })
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