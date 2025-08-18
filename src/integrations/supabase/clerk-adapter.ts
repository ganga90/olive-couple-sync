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
    
    // Create wrapper that adds Clerk auth to requests
    const authenticatedClient = {
      ...client,
      from: (table: string) => {
        const queryBuilder = client.from(table);
        
        // Override the query execution methods to add auth headers
        const addAuthToMethod = (methodName: string) => {
          const originalMethod = queryBuilder[methodName];
          if (typeof originalMethod === 'function') {
            queryBuilder[methodName] = async (...args: any[]) => {
              try {
                const token = await getToken({ template: "supabase" });
                if (token) {
                  // Set auth header for this specific request
                  queryBuilder.headers = {
                    ...queryBuilder.headers,
                    'Authorization': `Bearer ${token}`,
                  };
                }
                return await originalMethod.apply(queryBuilder, args);
              } catch (error) {
                console.error('[Clerk-Supabase] Auth error in', methodName, error);
                // Fallback to original method without auth
                return await originalMethod.apply(queryBuilder, args);
              }
            };
          }
        };

        // Add auth to common query methods
        ['select', 'insert', 'update', 'delete', 'upsert'].forEach(addAuthToMethod);
        
        return queryBuilder;
      },
      functions: {
        invoke: async (functionName: string, options?: any) => {
          try {
            const token = await getToken({ template: "supabase" });
            const headers = token ? {
              ...options?.headers,
              'Authorization': `Bearer ${token}`,
            } : options?.headers;
            
            return await client.functions.invoke(functionName, {
              ...options,
              headers,
            });
          } catch (error) {
            console.error('[Clerk-Supabase] Function invoke error:', error);
            // Fallback to original invoke
            return await client.functions.invoke(functionName, options);
          }
        }
      }
    };

    return authenticatedClient;
  }, [getToken]);
};