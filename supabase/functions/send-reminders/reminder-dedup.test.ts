import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { dedupeReminders } from "../_shared/reminder-dedup.ts";

Deno.test("dedupeReminders keeps one reminder per task and prefers explicit reminder", () => {
  const result = dedupeReminders([
    { id: "note-1", summary: "Dinner at Wayan", reminder_type: "15min", reminder_message: "in 15 minutes" },
    { id: "note-1", summary: "Dinner at Wayan", reminder_time: "2026-04-12T20:15:00.000Z" },
  ]);

  assertEquals(result.length, 1);
  assertEquals(result[0].id, "note-1");
  assertEquals(result[0].reminder_time, "2026-04-12T20:15:00.000Z");
});

Deno.test("dedupeReminders prefers the most urgent due-date reminder when no explicit reminder exists", () => {
  const result = dedupeReminders([
    { id: "note-2", summary: "Flight", reminder_type: "24h", reminder_message: "in 24 hours" },
    { id: "note-2", summary: "Flight", reminder_type: "15min", reminder_message: "in 15 minutes" },
  ]);

  assertEquals(result.length, 1);
  assertEquals(result[0].reminder_type, "15min");
  assertEquals(result[0].reminder_message, "in 15 minutes");
});
