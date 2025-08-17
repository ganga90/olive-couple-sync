import { useAuth, useUser } from "@clerk/clerk-react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { useMemo } from "react";

const supabaseUrl = "https://wtfspzvcetxmcfftwonq.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg";

// Hook to get Clerk-authenticated Supabase client
export const useClerkSupabaseClient = () => {
  const { getToken } = useAuth();
  
  return useMemo(() => {
    return createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }, []);
};

// Function to get authenticated headers for Supabase requests
export const useClerkSupabaseHeaders = () => {
  const { getToken } = useAuth();
  
  return useMemo(() => {
    return {
      getHeaders: async () => {
        const token = await getToken({ template: "supabase" });
        return token ? { Authorization: `Bearer ${token}` } : {};
      }
    };
  }, [getToken]);
};

// Helper to create a Supabase client with Clerk user context
export const createClerkSupabaseClient = () => {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};