import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '@clerk/clerk-react'
import { useMemo } from 'react'
import type { Database } from '@/integrations/supabase/types'

const SUPABASE_URL = "https://wtfspzvcetxmcfftwonq.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"

export function useSupabase(): SupabaseClient<Database> {
  const { getToken } = useAuth()

  return useMemo(() => {
    // Guardrails: scream in console if envs are missing
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY')
    } else {
      console.log('[Supabase] URL ok, anon key present:', SUPABASE_ANON_KEY.slice(0, 6) + '…')
    }

    return createClient<Database>(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        accessToken: async () => {
          // Plain Clerk session token (no JWT template)
          const token = await getToken()
          console.log('[Supabase] Token obtained:', token ? 'present' : 'missing')
          return token
        },
        auth: { persistSession: false, autoRefreshToken: false },
        
        // TEMP DEBUG: log outgoing headers to ensure apikey+auth are present
        global: {
          fetch: async (input, init) => {
            const hdrs = new Headers(init?.headers || {})
            const hasApiKey = hdrs.has('apikey')
            const hasAuth = hdrs.has('authorization')
            if (!(hasApiKey && hasAuth)) {
              console.warn('[Supabase fetch] Missing headers', { 
                hasApiKey, 
                hasAuth, 
                url: String(input),
                headers: Object.fromEntries(hdrs.entries())
              })
            }
            return fetch(input, init)
          },
        },
      }
    )
  }, [getToken])
}