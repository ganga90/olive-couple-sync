import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Hook for providing haptic feedback on iOS/Android via Capacitor
 * Falls back gracefully on web
 */
export const useHaptics = () => {
  const isNative = Capacitor.isNativePlatform();

  const impactLight = async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) {
      // Silently fail on unsupported platforms
    }
  };

  const impactMedium = async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (e) {
      // Silently fail
    }
  };

  const impactHeavy = async () => {
    if (!isNative) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (e) {
      // Silently fail
    }
  };

  const notificationSuccess = async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (e) {
      // Silently fail
    }
  };

  const notificationWarning = async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch (e) {
      // Silently fail
    }
  };

  const notificationError = async () => {
    if (!isNative) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch (e) {
      // Silently fail
    }
  };

  const selectionChanged = async () => {
    if (!isNative) return;
    try {
      await Haptics.selectionChanged();
    } catch (e) {
      // Silently fail
    }
  };

  return {
    isNative,
    impactLight,
    impactMedium,
    impactHeavy,
    notificationSuccess,
    notificationWarning,
    notificationError,
    selectionChanged,
  };
};
