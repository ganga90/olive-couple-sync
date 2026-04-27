import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * Token cache implementation for Clerk on Capacitor native apps.
 * This stores JWT tokens securely using Capacitor Preferences.
 *
 * Note: For production, consider using @capacitor-community/secure-storage-plugin
 * for encrypted storage.
 */

const TOKEN_KEY_PREFIX = '__clerk_'

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      if (!Capacitor.isNativePlatform()) {
        // On web, use localStorage as fallback
        return localStorage.getItem(`${TOKEN_KEY_PREFIX}${key}`)
      }

      const { value } = await Preferences.get({ key: `${TOKEN_KEY_PREFIX}${key}` })
      console.log('[TokenCache] getToken:', key, '=', value ? 'exists' : 'null')
      return value
    } catch (error) {
      console.error('[TokenCache] Error getting token:', error)
      return null
    }
  },

  async saveToken(key: string, value: string): Promise<void> {
    try {
      if (!Capacitor.isNativePlatform()) {
        // On web, use localStorage as fallback
        localStorage.setItem(`${TOKEN_KEY_PREFIX}${key}`, value)
        return
      }

      await Preferences.set({ key: `${TOKEN_KEY_PREFIX}${key}`, value })
      console.log('[TokenCache] saveToken:', key, '= saved')
    } catch (error) {
      console.error('[TokenCache] Error saving token:', error)
    }
  },

  async clearToken(key: string): Promise<void> {
    try {
      if (!Capacitor.isNativePlatform()) {
        localStorage.removeItem(`${TOKEN_KEY_PREFIX}${key}`)
        return
      }

      await Preferences.remove({ key: `${TOKEN_KEY_PREFIX}${key}` })
      console.log('[TokenCache] clearToken:', key)
    } catch (error) {
      console.error('[TokenCache] Error clearing token:', error)
    }
  }
}

export default tokenCache
