// src/lib/supabaseClient.ts  
import { createClient } from '@supabase/supabase-js'

const URL = "https://wtfspzvcetxmcfftwonq.supabase.co"
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"

let tokenGetter: null | (() => Promise<string | null>) = null
export const setClerkTokenGetter = (fn: () => Promise<string | null>) => { tokenGetter = fn }

export const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false }, // we are not using GoTrue
  global: {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers ?? {})
      if (!headers.has('apikey')) headers.set('apikey', ANON)
      const token = tokenGetter ? await tokenGetter() : null
      if (token && !headers.has('authorization')) {
        headers.set('authorization', `Bearer ${token}`)
      }
      return fetch(input as RequestInfo, { ...init, headers })
    },
  },
})

// Temporary export for backwards compatibility during cache clear
export const getSupabase = () => {
  console.warn('⚠️ DEPRECATED: getSupabase() is deprecated. Use supabase directly instead.')
  return supabase
}
