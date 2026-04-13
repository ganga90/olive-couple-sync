/**
 * useHaptics — Lightweight wrapper around Capacitor Haptics for native iOS feel.
 *
 * Provides impact, notification, and selection feedback.
 * No-ops gracefully on web (no errors, no console noise).
 */
import { useCallback } from "react";
import { Capacitor } from "@capacitor/core";

let hapticsModule: typeof import("@capacitor/haptics") | null = null;

// Lazy-load to avoid bundling on web
async function getHaptics() {
  if (!Capacitor.isNativePlatform()) return null;
  if (!hapticsModule) {
    hapticsModule = await import("@capacitor/haptics");
  }
  return hapticsModule.Haptics;
}

export function useHaptics() {
  const isNative = Capacitor.isNativePlatform();

  /** Light tap — button press, toggle, selection change */
  const impactLight = useCallback(async () => {
    const h = await getHaptics();
    h?.impact({ style: (await import("@capacitor/haptics")).ImpactStyle.Light });
  }, []);

  /** Medium tap — confirming an action, dragging */
  const impactMedium = useCallback(async () => {
    const h = await getHaptics();
    h?.impact({ style: (await import("@capacitor/haptics")).ImpactStyle.Medium });
  }, []);

  /** Heavy tap — destructive action, significant state change */
  const impactHeavy = useCallback(async () => {
    const h = await getHaptics();
    h?.impact({ style: (await import("@capacitor/haptics")).ImpactStyle.Heavy });
  }, []);

  /** Success — task completed, action confirmed */
  const notifySuccess = useCallback(async () => {
    const h = await getHaptics();
    h?.notification({ type: (await import("@capacitor/haptics")).NotificationType.Success });
  }, []);

  /** Warning — overdue, approaching limit */
  const notifyWarning = useCallback(async () => {
    const h = await getHaptics();
    h?.notification({ type: (await import("@capacitor/haptics")).NotificationType.Warning });
  }, []);

  /** Error — failed action */
  const notifyError = useCallback(async () => {
    const h = await getHaptics();
    h?.notification({ type: (await import("@capacitor/haptics")).NotificationType.Error });
  }, []);

  /** Selection changed — picker, toggle option */
  const selectionChanged = useCallback(async () => {
    const h = await getHaptics();
    h?.selectionChanged();
  }, []);

  return {
    isNative,
    impactLight,
    impactMedium,
    impactHeavy,
    notifySuccess,
    notifyWarning,
    notifyError,
    selectionChanged,
  };
}

export default useHaptics;
