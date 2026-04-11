/**
 * Natural Date Parser — Multilingual Date/Time Extraction
 * =========================================================
 * Parses natural language date/time expressions in English, Spanish, and Italian.
 * Handles relative times ("in 30 minutes"), named dates ("tomorrow", "next Monday"),
 * month+day ("March 15"), standalone times ("at 3pm"), and timezone-aware conversion.
 *
 * Extracted from whatsapp-webhook to enable reuse across:
 *   - WhatsApp webhook (reminder/due date parsing)
 *   - process-note (due date extraction)
 *   - ask-olive-stream (calendar context)
 *
 * Usage:
 *   import { parseNaturalDate } from "../_shared/natural-date-parser.ts";
 *   const { date, time, readable } = parseNaturalDate("tomorrow at 3pm", "America/New_York");
 */

export interface ParsedDate {
  date: string | null;
  time: string | null;
  readable: string;
}

export function parseNaturalDate(
  expression: string,
  timezone: string = "America/New_York"
): ParsedDate {
  const now = new Date();

  // CRITICAL: Create a "local now" whose UTC fields represent the user's local time.
  // Prevents off-by-one day errors when UTC date differs from local date.
  let localNow: Date;
  try {
    const localStr = now.toLocaleString("en-US", { timeZone: timezone });
    localNow = new Date(localStr);
  } catch {
    localNow = new Date(now);
  }

  const lowerExpr = expression.toLowerCase().trim();
  const formatDate = (d: Date): string => d.toISOString();

  // Word-to-number map for natural language ("in one hour", "in two minutes")
  const wordToNum: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
    "forty-five": 45, "forty five": 45, sixty: 60, ninety: 90,
    // Spanish
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15,
    veinte: 20, treinta: 30, media: 0.5,
    // Italian
    "un'": 1, mezza: 0.5, "mezz'ora": 0.5, due: 2, tre_it: 3, quattro: 4,
    cinque_it: 5, sei_it: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
    quindici: 15, venti: 20, trenta: 30,
  };

  function resolveNumber(token: string): number | null {
    const n = parseInt(token);
    if (!isNaN(n)) return n;
    return wordToNum[token.toLowerCase()] ?? null;
  }

  const monthNames: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
    // Spanish
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    // Italian
    gennaio: 0, febbraio: 1, aprile: 3, maggio: 4, giugno: 5,
    luglio: 6, settembre: 8, ottobre: 9, novembre: 10,
  };

  const getNextDayOfWeek = (dayName: string): Date => {
    const dayMap: Record<string, number> = {
      sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2,
      wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5,
      saturday: 6, sat: 6,
      // Spanish
      domingo: 0, lunes: 1, martes: 2, "miércoles": 3, miercoles: 3,
      jueves: 4, viernes: 5, "sábado": 6, sabado: 6,
      // Italian
      domenica: 0, "lunedì": 1, lunedi: 1, "martedì": 2, martedi: 2,
      "mercoledì": 3, mercoledi: 3, "giovedì": 4, giovedi: 4,
      "venerdì": 5, venerdi: 5,
    };
    const targetDay = dayMap[dayName.toLowerCase()] ?? -1;
    if (targetDay === -1) return localNow;

    const result = new Date(localNow);
    const currentDay = result.getDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(9, 0, 0, 0);
    return result;
  };

  let hours: number | null = null;
  let minutes: number = 0;

  // Parse explicit time (e.g., "3pm", "10:30 AM", "15:00")
  const timeMatch = lowerExpr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const potentialHour = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem || potentialHour <= 12) {
      hours = potentialHour;
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
    }
  }

  // Named time-of-day keywords (multilingual)
  if (lowerExpr.includes("morning") || lowerExpr.includes("mañana") || lowerExpr.includes("mattina")) {
    hours = hours ?? 9;
  } else if (/\bnoon\b/.test(lowerExpr) || /\bmidday\b/.test(lowerExpr) || /\bmezzogiorno\b/.test(lowerExpr) || /\bmediodía\b/.test(lowerExpr) || /\bmediodia\b/.test(lowerExpr)) {
    hours = hours ?? 12; minutes = 0;
  } else if (lowerExpr.includes("afternoon") || lowerExpr.includes("pomeriggio") || lowerExpr.includes("tarde")) {
    hours = hours ?? 14;
  } else if (lowerExpr.includes("evening") || lowerExpr.includes("sera") || lowerExpr.includes("noche")) {
    hours = hours ?? 18;
  } else if (lowerExpr.includes("night") || lowerExpr.includes("notte")) {
    hours = hours ?? 20;
  } else if (lowerExpr.includes("midnight") || lowerExpr.includes("mezzanotte") || lowerExpr.includes("medianoche")) {
    hours = hours ?? 0; minutes = 0;
  }

  let targetDate: Date | null = null;
  let readable = "";

  // === RELATIVE TIME EXPRESSIONS (highest priority) ===
  const relativePatterns = [
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:min(?:ute)?s?|minuto?s?|minut[io])/i,
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:hours?|hrs?|or[ae]s?|or[ae])/i,
    /in\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:days?|días?|dias?|giorn[io])/i,
    /(?:half\s+(?:an?\s+)?hour|mezz'?ora|media\s+hora)/i,
  ];

  const halfHourMatch = lowerExpr.match(relativePatterns[3]);
  if (halfHourMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + 30);
    readable = "in 30 minutes";
    hours = targetDate.getHours();
    minutes = targetDate.getMinutes();
  }

  if (!targetDate) {
    const minMatch = lowerExpr.match(relativePatterns[0]);
    if (minMatch) {
      const num = resolveNumber(minMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        targetDate.setMinutes(targetDate.getMinutes() + Math.round(num));
        readable = `in ${Math.round(num)} minutes`;
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const hrMatch = lowerExpr.match(relativePatterns[1]);
    if (hrMatch) {
      const num = resolveNumber(hrMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        if (num === 0.5) {
          targetDate.setMinutes(targetDate.getMinutes() + 30);
          readable = "in 30 minutes";
        } else {
          targetDate.setHours(targetDate.getHours() + Math.round(num));
          readable = `in ${Math.round(num)} hour${num > 1 ? "s" : ""}`;
        }
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const dayMatch = lowerExpr.match(relativePatterns[2]);
    if (dayMatch) {
      const num = resolveNumber(dayMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + Math.round(num));
        readable = `in ${Math.round(num)} day${num > 1 ? "s" : ""}`;
      }
    }
  }

  // === NAMED DATE EXPRESSIONS ===
  if (!targetDate) {
    if (lowerExpr.includes("today") || lowerExpr.includes("hoy") || lowerExpr.includes("oggi")) {
      targetDate = new Date(localNow);
      readable = "today";
    } else if (lowerExpr.includes("tomorrow") || /\bmañana\b/.test(lowerExpr) || lowerExpr.includes("domani")) {
      targetDate = new Date(localNow);
      targetDate.setDate(targetDate.getDate() + 1);
      readable = "tomorrow";
    } else if (lowerExpr.includes("day after tomorrow") || lowerExpr.includes("pasado mañana") || lowerExpr.includes("dopodomani")) {
      targetDate = new Date(localNow);
      targetDate.setDate(targetDate.getDate() + 2);
      readable = "day after tomorrow";
    } else if (lowerExpr.includes("next week") || lowerExpr.includes("próxima semana") || lowerExpr.includes("prossima settimana") || lowerExpr.includes("la semana que viene") || lowerExpr.includes("settimana prossima")) {
      targetDate = new Date(localNow);
      targetDate.setDate(targetDate.getDate() + 7);
      readable = "next week";
    } else if (lowerExpr.includes("in a week") || lowerExpr.includes("in 1 week") || lowerExpr.includes("en una semana") || lowerExpr.includes("tra una settimana") || lowerExpr.includes("fra una settimana")) {
      targetDate = new Date(localNow);
      targetDate.setDate(targetDate.getDate() + 7);
      readable = "in a week";
    } else if (lowerExpr.includes("this weekend") || lowerExpr.includes("este fin de semana") || lowerExpr.includes("questo weekend") || lowerExpr.includes("questo fine settimana")) {
      targetDate = new Date(localNow);
      const currentDay = targetDate.getDay();
      const daysUntilSaturday = currentDay === 6 ? 0 : 6 - currentDay;
      targetDate.setDate(targetDate.getDate() + daysUntilSaturday);
      readable = "this weekend";
    } else if (lowerExpr.includes("next month") || lowerExpr.includes("próximo mes") || lowerExpr.includes("prossimo mese") || lowerExpr.includes("il mese prossimo")) {
      targetDate = new Date(localNow);
      targetDate.setMonth(targetDate.getMonth() + 1);
      readable = "next month";
    }
  }

  // === MONTH + DAY EXPRESSIONS ===
  if (!targetDate) {
    const ddMonMatch = lowerExpr.match(
      /(\d{1,2})[\s-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|novembre|dicembre)/i
    );
    if (ddMonMatch) {
      const dayNum = parseInt(ddMonMatch[1]);
      const monthWord = ddMonMatch[2].toLowerCase();
      const abbrMonthMap: Record<string, number> = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
        apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
        aug: 7, august: 7, sep: 8, sept: 8, september: 8,
        oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
        enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
        julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
        gennaio: 0, febbraio: 1, aprile: 3, maggio: 4, giugno: 5,
        luglio: 6, settembre: 8, ottobre: 9, novembre: 10,
      };
      const monthNum = abbrMonthMap[monthWord] ?? monthNames[monthWord];
      if (monthNum !== undefined && dayNum >= 1 && dayNum <= 31) {
        targetDate = new Date(localNow.getFullYear(), monthNum, dayNum);
        if (hours !== null) {
          targetDate.setHours(hours, minutes, 0, 0);
        } else {
          targetDate.setHours(9, 0, 0, 0);
        }
        if (targetDate < localNow) {
          targetDate.setFullYear(targetDate.getFullYear() + 1);
        }
        const monthDisplayNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December",
        ];
        readable = `${monthDisplayNames[monthNum]} ${dayNum}`;
      }
    }

    // Handle "Month DD" format
    if (!targetDate) {
      for (const [monthWord, monthNum] of Object.entries(monthNames)) {
        const monthDayMatch = lowerExpr.match(
          new RegExp(`${monthWord}\s+(\d{1,2})(?:st|nd|rd|th)?`, "i")
        );
        if (monthDayMatch) {
          const dayNum = parseInt(monthDayMatch[1]);
          if (dayNum >= 1 && dayNum <= 31) {
            targetDate = new Date(localNow.getFullYear(), monthNum, dayNum);
            if (hours !== null) {
              targetDate.setHours(hours, minutes, 0, 0);
            } else {
              targetDate.setHours(9, 0, 0, 0);
            }
            if (targetDate < localNow) {
              targetDate.setFullYear(targetDate.getFullYear() + 1);
            }
            const monthDisplayNames = [
              "January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December",
            ];
            readable = `${monthDisplayNames[monthNum]} ${dayNum}`;
          }
          break;
        }
      }
    }
  }

  // === DAY-OF-WEEK ===
  if (!targetDate) {
    const allDayNames = [
      "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
      "sun", "mon", "tue", "wed", "thu", "fri", "sat",
      "domingo", "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado",
      "domenica", "lunedì", "lunedi", "martedì", "martedi", "mercoledì", "mercoledi", "giovedì", "giovedi", "venerdì", "venerdi",
    ];
    for (const day of allDayNames) {
      if (lowerExpr.includes(day)) {
        targetDate = getNextDayOfWeek(day);
        const displayDay = day.charAt(0).toUpperCase() + day.slice(1);
        readable = `next ${displayDay}`;
        break;
      }
    }
  }

  // === STANDALONE TIME (no date) → default to TODAY ===
  if (!targetDate && hours !== null) {
    targetDate = new Date(localNow);
    const localHour = localNow.getHours();
    const localMinute = localNow.getMinutes();
    const proposedMinutes = hours * 60 + minutes;
    const currentMinutes = localHour * 60 + localMinute;

    if (proposedMinutes <= currentMinutes) {
      targetDate.setDate(targetDate.getDate() + 1);
      readable = "tomorrow";
    } else {
      readable = "today";
    }
  }

  // === APPLY TIME (timezone-aware) ===
  if (targetDate && hours !== null) {
    targetDate.setHours(hours, minutes, 0, 0);
    try {
      const utcStr = targetDate.toLocaleString("en-US", { timeZone: "UTC" });
      const tzStr = targetDate.toLocaleString("en-US", { timeZone: timezone });
      const utcDate = new Date(utcStr);
      const tzDate = new Date(tzStr);
      const offsetMs = utcDate.getTime() - tzDate.getTime();
      targetDate = new Date(targetDate.getTime() + offsetMs);
    } catch {
      // If timezone conversion fails, keep as-is
    }

    if (!readable.includes("minute") && !readable.includes("hour")) {
      readable += ` at ${hours > 12 ? hours - 12 : hours === 0 ? 12 : hours}:${minutes.toString().padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
    }
  } else if (targetDate && hours === null) {
    if (!readable.includes("minute") && !readable.includes("hour")) {
      targetDate.setHours(9, 0, 0, 0);
      try {
        const utcStr = targetDate.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = targetDate.toLocaleString("en-US", { timeZone: timezone });
        const utcDate = new Date(utcStr);
        const tzDate = new Date(tzStr);
        const offsetMs = utcDate.getTime() - tzDate.getTime();
        targetDate = new Date(targetDate.getTime() + offsetMs);
      } catch {
        /* keep as-is */
      }
      readable += " at 9:00 AM";
    }
  }

  if (!targetDate) {
    return { date: null, time: null, readable: "unknown" };
  }

  return { date: formatDate(targetDate), time: formatDate(targetDate), readable };
}
