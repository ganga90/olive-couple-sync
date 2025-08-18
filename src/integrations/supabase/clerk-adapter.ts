import { useAuth, useUser } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Single Supabase client instance to avoid multiple GoTrueClient warnings
let supabaseClient: any = null;

const getSupabaseClient = () => {
  if (!supabaseClient) {
    supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseClient;
};

// Hook to get Clerk-authenticated Supabase client
export const useClerkSupabaseClient = () => {
  const { getToken } = useAuth();
  
  return useMemo(() => {
    const client = getSupabaseClient();
    
    // Create a simple wrapper that preserves all original client functionality
    const authenticatedClient = {
      ...client,
      from: (table: string) => client.from(table),
      functions: client.functions,
      channel: client.channel ? client.channel.bind(client) : undefined,
      removeChannel: client.removeChannel ? client.removeChannel.bind(client) : undefined,
    };

    // Override only the functions.invoke method to add auth
    const originalInvoke = client.functions.invoke.bind(client.functions);
    authenticatedClient.functions = {
      ...client.functions,
      invoke: async (functionName: string, options?: any) => {
        try {
          const token = await getToken({ template: "supabase" });
          if (token) {
            const authHeaders = {
              ...options?.headers,
              'Authorization': `Bearer ${token}`,
            };
            return await originalInvoke(functionName, {
              ...options,
              headers: authHeaders,
            });
          }
          return await originalInvoke(functionName, options);
        } catch (error) {
          console.error('[Clerk-Supabase] Function invoke error:', error);
          return await originalInvoke(functionName, options);
        }
      }
    };

    return authenticatedClient;
  }, [getToken]);
};