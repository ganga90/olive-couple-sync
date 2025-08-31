import { Capacitor } from '@capacitor/core';

export enum PermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  PROMPT = 'prompt',
  UNKNOWN = 'unknown'
}

export interface MicrophonePermissionResult {
  status: PermissionStatus;
  canRequest: boolean;
}

/**
 * Cross-platform microphone permission handling for web and mobile
 */
export class MicrophonePermissions {
  /**
   * Check current microphone permission status
   */
  static async checkPermission(): Promise<MicrophonePermissionResult> {
    try {
      if (Capacitor.isNativePlatform()) {
        // Mobile: For native platforms, we'll use getUserMedia directly
        // as Capacitor handles permissions at the native level automatically
        return {
          status: PermissionStatus.UNKNOWN, // Will be determined when requesting
          canRequest: true
        };
      } else {
        // Web: Use Navigator permissions API
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            return {
              status: permission.state as PermissionStatus,
              canRequest: permission.state !== PermissionStatus.DENIED
            };
          } catch (error) {
            console.warn('[MicrophonePermissions] Permissions API not supported:', error);
          }
        }

        // Fallback: Try to access microphone directly to check permission
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: true 
          });
          // Clean up immediately
          stream.getTracks().forEach(track => track.stop());
          
          return {
            status: PermissionStatus.GRANTED,
            canRequest: true
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
              return {
                status: PermissionStatus.DENIED,
                canRequest: false
              };
            }
            if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
              throw new Error('No microphone device found');
            }
          }
          
          return {
            status: PermissionStatus.UNKNOWN,
            canRequest: true
          };
        }
      }
    } catch (error) {
      console.error('[MicrophonePermissions] Error checking permission:', error);
      return {
        status: PermissionStatus.UNKNOWN,
        canRequest: true
      };
    }
  }

  /**
   * Request microphone permission
   */
  static async requestPermission(): Promise<MicrophonePermissionResult> {
    try {
      if (Capacitor.isNativePlatform()) {
        // Mobile: On native platforms, permissions are handled automatically
        // when getUserMedia is called, so we'll attempt access directly
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop()); // Clean up
          
          return {
            status: PermissionStatus.GRANTED,
            canRequest: true
          };
        } catch (error) {
          return {
            status: PermissionStatus.DENIED,
            canRequest: false
          };
        }
      } else {
        // Web: Request permission by attempting to access microphone
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: true 
          });
          
          // Keep the stream active for the caller to use
          return {
            status: PermissionStatus.GRANTED,
            canRequest: true
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
              return {
                status: PermissionStatus.DENIED,
                canRequest: false
              };
            }
            if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
              throw new Error('No microphone device found');
            }
          }
          
          return {
            status: PermissionStatus.UNKNOWN,
            canRequest: false
          };
        }
      }
    } catch (error) {
      console.error('[MicrophonePermissions] Error requesting permission:', error);
      throw error;
    }
  }

  /**
   * Get user media stream with proper permission handling
   */
  static async getUserMediaStream(): Promise<MediaStream> {
    // First check/request permissions
    const permissionResult = await this.checkPermission();
    
    if (permissionResult.status === PermissionStatus.DENIED) {
      throw new Error('Microphone access denied. Please enable microphone permissions in your device settings.');
    }

    if (permissionResult.status !== PermissionStatus.GRANTED) {
      const requestResult = await this.requestPermission();
      
      if (requestResult.status !== PermissionStatus.GRANTED) {
        throw new Error('Microphone permission required for voice input');
      }
    }

    // Now get the actual media stream
    try {
      return await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          throw new Error('No microphone device found');
        }
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          throw new Error('Microphone access denied');
        }
        if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          throw new Error('Microphone is already in use by another application');
        }
      }
      
      throw new Error('Failed to access microphone');
    }
  }
}
