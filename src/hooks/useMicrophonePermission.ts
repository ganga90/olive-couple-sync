import { useState, useEffect } from 'react';
import { MicrophonePermissions, PermissionStatus, type MicrophonePermissionResult } from '@/lib/microphone-permissions';

export function useMicrophonePermission() {
  const [permission, setPermission] = useState<MicrophonePermissionResult>({
    status: PermissionStatus.UNKNOWN,
    canRequest: true
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkPermission = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await MicrophonePermissions.checkPermission();
      setPermission(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check microphone permission';
      setError(errorMessage);
      console.error('[useMicrophonePermission] Error checking permission:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermission = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await MicrophonePermissions.requestPermission();
      setPermission(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to request microphone permission';
      setError(errorMessage);
      console.error('[useMicrophonePermission] Error requesting permission:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const getUserMediaStream = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const stream = await MicrophonePermissions.getUserMediaStream();
      
      // Update permission status to granted since we successfully got the stream
      setPermission({
        status: PermissionStatus.GRANTED,
        canRequest: true
      });
      
      return stream;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to access microphone';
      setError(errorMessage);
      
      // Update permission status based on the error
      if (errorMessage.includes('denied') || errorMessage.includes('NotAllowed')) {
        setPermission({
          status: PermissionStatus.DENIED,
          canRequest: false
        });
      }
      
      console.error('[useMicrophonePermission] Error getting user media:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Check permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  return {
    permission,
    isLoading,
    error,
    checkPermission,
    requestPermission,
    getUserMediaStream,
    hasPermission: permission.status === PermissionStatus.GRANTED,
    isPermissionDenied: permission.status === PermissionStatus.DENIED,
    canRequestPermission: permission.canRequest
  };
}