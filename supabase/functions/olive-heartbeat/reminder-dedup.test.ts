import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { dedupeReminders } from "../_shared/reminder-dedup.ts";

Deno.test("dedupeReminders keeps one heartbeat task entry when explicit and auto reminders collide", () => {
  const result = dedupeReminders([
    { id: "note-1", summary: "Dinner at Wayan", _reminderType: "15min", _reminderMsg: "in 15 minutes" },
    { id: "note-1", summary: "Dinner at Wayan", reminder_time: "2026-04-12T20:15:00.000Z" },
  ]);

  assertEquals(result.length, 1);
  assertEquals(result[0].summary, "Dinner at Wayan");
  assertEquals(result[0].reminder_time, "2026-04-12T20:15:00.000Z");
});
