import { Note } from "@/types/note";

export async function generateOliveReply(note: Note, userMessage: string): Promise<string> {
  // Simple heuristic-based assistant to simulate AI until a backend is connected
  const lower = userMessage.toLowerCase();
  const tips: string[] = [];

  if (note.category === "Groceries") {
    tips.push("Consider adding quantities and brands to your grocery items for faster shopping.");
    if (/when|time|schedule/.test(lower)) tips.push("Pick a time when your store is less crowded—usually mornings on weekdays.");
  }
  if (note.category === "Task") {
    tips.push("Break the task into smaller steps and set a due date.");
    if (/prioriti|first|start/.test(lower)) tips.push("Start with a 5-minute action to build momentum.");
  }
  if (note.category === "Home Improvement") {
    tips.push("Gather materials first and plan the work in 1–2 hour blocks.");
  }
  if (note.category === "Travel Idea") {
    tips.push("Save spots in a list and check flight alerts for price drops.");
  }
  if (note.category === "Date Idea") {
    tips.push("Add a budget and time window to make it easier to schedule.");
  }

  if (lower.includes("suggest") || lower.includes("idea")) {
    tips.push("Would you like me to create a checklist from this note?");
  }

  const base = `Here to help with “${note.summary}”.`;
  return [base, ...tips].join(" \n\n• ");
}
