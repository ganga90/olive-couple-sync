import { createClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import type { Database } from '@/integrations/supabase/types'

const SUPABASE_URL = "https://wtfspzvcetxmcfftwonq.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"

export function useSupabase() {
  const { getToken } = useAuth()
  
  return useMemo(() => {
    return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      accessToken: async () => await getToken(),
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // TEMP: warn if any request misses headers
        fetch: async (input, init) => {
          const h = new Headers(init?.headers || {})
          if (!h.has('apikey') || !h.has('authorization')) {
            console.warn('[supabase] missing headers', { 
              url: String(input), 
              apikey: h.has('apikey'), 
              auth: h.has('authorization') 
            })
          }
          return fetch(input, init)
        },
      },
    })
  }, [getToken])
}