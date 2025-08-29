// src/lib/supabaseClient.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import type { Database } from '@/integrations/supabase/types'

const SUPABASE_URL = "https://wtfspzvcetxmcfftwonq.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"

export function useSupabase(): SupabaseClient<Database> {
  const { getToken } = useAuth()

  return useMemo(() => {
    return createClient<Database>(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        accessToken: async () => {
          // Plain Clerk session token (no JWT template)
          return await getToken()
        },
        auth: { persistSession: false, autoRefreshToken: false },
      }
    )
  }, [getToken])
}