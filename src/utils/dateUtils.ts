import { format, parse, isValid } from 'date-fns';

/**
 * Timezone-safe date utilities for handling dates without time component.
 * 
 * The Problem:
 * When storing dates like "2026-02-20", using `new Date("2026-02-20").toISOString()` 
 * creates "2026-02-20T00:00:00.000Z" (midnight UTC). When this is displayed in a 
 * timezone west of UTC (e.g., EST -5 hours), it shows as Feb 19 at 7pm.
 * 
 * The Solution:
 * Store dates at noon UTC (12:00:00) so they stay on the correct date regardless 
 * of the user's timezone (±12 hours from noon still lands on the same day).
 */

/**
 * Parses a date string (ISO or date-only) and returns a Date object
 * representing that date at noon local time, avoiding timezone shifts.
 */
export const parseDateSafely = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  
  // Extract just the date part if it's an ISO string
  const dateOnly = dateStr.split('T')[0];
  
  // Parse as year, month, day components
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (!year || !month || !day) return null;
  
  // Create date at noon local time to avoid edge cases
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return isValid(date) ? date : null;
};

/**
 * Formats a Date object to an ISO string at noon UTC.
 * This ensures the date stays consistent regardless of timezone.
 */
export const formatDateForStorage = (date: Date | null | undefined): string | null => {
  if (!date || !isValid(date)) return null;
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Store at noon UTC to avoid timezone boundary issues
  return `${year}-${month}-${day}T12:00:00.000Z`;
};

/**
 * Converts a date string to storage format directly (YYYY-MM-DD → ISO at noon)
 */
export const dateStringToStorage = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  
  // If it's already an ISO string, extract the date part
  const dateOnly = dateStr.split('T')[0];
  
  // Validate the format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  
  return `${dateOnly}T12:00:00.000Z`;
};

/**
 * Extracts just the date portion from an ISO string (YYYY-MM-DD)
 */
export const extractDateOnly = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
};

/**
 * Formats a date string or Date object for display (e.g., "Feb 20")
 */
export const formatDateForDisplay = (
  dateStr: string | null | undefined, 
  formatStr: string = 'MMM d'
): string => {
  const date = parseDateSafely(dateStr);
  if (!date) return '';
  return format(date, formatStr);
};

/**
 * Parses user input in various formats and returns a Date object
 */
export const parseUserDateInput = (input: string): Date | null => {
  const formats = ['dd/MM/yyyy', 'MM/dd/yyyy', 'd/M/yyyy', 'yyyy-MM-dd'];
  
  for (const fmt of formats) {
    const parsed = parse(input.trim(), fmt, new Date());
    if (isValid(parsed) && parsed.getFullYear() > 2000) {
      return parsed;
    }
  }
  
  return null;
};
