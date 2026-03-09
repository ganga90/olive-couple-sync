import { useEffect } from 'react';
import { useIsMobile } from './use-mobile';

interface KeyboardShortcut {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  callback: () => void;
  description: string;
}

/**
 * Global keyboard shortcuts hook for desktop users
 * Handles Cmd+K (search), Cmd+N (new note), etc.
 */
export const useKeyboardShortcuts = (shortcuts: KeyboardShortcut[]) => {
  const isMobile = useIsMobile();

  useEffect(() => {
    // Only register shortcuts on desktop
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Allow Escape to close modals even in inputs
        if (e.key !== 'Escape') return;
      }

      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.metaKey ? e.metaKey || e.ctrlKey : true;
        const ctrlMatch = shortcut.ctrlKey ? e.ctrlKey : true;
        const shiftMatch = shortcut.shiftKey ? e.shiftKey : !e.shiftKey;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        if (keyMatch && metaMatch && ctrlMatch && shiftMatch) {
          e.preventDefault();
          shortcut.callback();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, isMobile]);
};

/**
 * Standard app-wide shortcuts
 */
export const APP_SHORTCUTS = {
  SEARCH: { key: 'k', metaKey: true, description: 'Open search' },
  NEW_NOTE: { key: 'n', metaKey: true, description: 'Create new note' },
  ESCAPE: { key: 'Escape', description: 'Close modal/dialog' },
};
