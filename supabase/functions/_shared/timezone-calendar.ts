interface TimeZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
    second: Number(getPart("second")),
    weekday: WEEKDAY_INDEX[getPart("weekday")] ?? 0,
  };
}

function getOffsetMs(date: Date, timeZone: string): number {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function toUtcFromLocalParts(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  let offset = getOffsetMs(new Date(utcGuess), timeZone);
  let resolved = new Date(utcGuess - offset);
  const nextOffset = getOffsetMs(resolved, timeZone);

  if (nextOffset !== offset) {
    offset = nextOffset;
    resolved = new Date(utcGuess - offset);
  }

  return resolved;
}

function addLocalDays(parts: Pick<TimeZoneParts, "year" | "month" | "day">, days: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function parseStoredTimestamp(dateStr?: string | null): Date | null {
  if (!dateStr) return null;

  const isoDateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, year, month, day] = isoDateOnly;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getRelativeDayWindowUtc(reference: Date, timeZone: string, dayOffset = 0) {
  const localReference = getTimeZoneParts(reference, timeZone);
  const localStart = addLocalDays(localReference, dayOffset);
  const localEnd = addLocalDays(localReference, dayOffset + 1);

  return {
    start: toUtcFromLocalParts({ ...localStart, hour: 0, minute: 0, second: 0 }, timeZone),
    end: toUtcFromLocalParts({ ...localEnd, hour: 0, minute: 0, second: 0 }, timeZone),
  };
}

export function getNextWeekBoundaryUtc(reference: Date, timeZone: string): Date {
  const localReference = getTimeZoneParts(reference, timeZone);
  const daysUntilNextMonday = localReference.weekday === 0 ? 1 : 8 - localReference.weekday;
  return getRelativeDayWindowUtc(reference, timeZone, daysUntilNextMonday).start;
}

export function isInUtcRange(dateStr: string | null | undefined, start: Date, end: Date): boolean {
  const parsed = parseStoredTimestamp(dateStr);
  if (!parsed) return false;
  return parsed >= start && parsed < end;
}

export function isBeforeUtc(dateStr: string | null | undefined, boundary: Date): boolean {
  const parsed = parseStoredTimestamp(dateStr);
  if (!parsed) return false;
  return parsed < boundary;
}

export function formatTimeForZone(dateStr: string, timeZone: string): string {
  const parsed = parseStoredTimestamp(dateStr);
  if (!parsed) return dateStr;

  return parsed.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateForZone(
  dateStr: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const parsed = parseStoredTimestamp(dateStr);
  if (!parsed) return dateStr;

  return parsed.toLocaleDateString("en-US", {
    timeZone,
    ...options,
  });
}