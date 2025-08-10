import { Note } from "@/types/note";

// Enhanced assistant: captures context and proposes or applies small updates
export async function assistWithNote(
  note: Note,
  userMessage: string
): Promise<{ reply: string; updates?: Partial<Note> }> {
  const lower = userMessage.toLowerCase();
  const bullets: string[] = [];
  let updates: Partial<Note> | undefined;

  const replyStart = `Here to help with “${note.summary}”.`;

  // Simple location support for grocery items
  if (note.category === "Groceries") {
    if (/where\s+can\s+i\s+find/.test(lower)) {
      const match = lower.match(/find\s+([a-z\-\s]+)/);
      const item = match?.[1]?.trim() || "that item";
      bullets.push(
        `You’ll typically find ${item} in the produce section. Pick firm, heavy ones; avoid soft spots. I can add a quality tip to your note if you want.`
      );
    }

    // Parse quantities like "5 lemons" or "2x lemons"
    const qtyMatch = lower.match(/(\d+)\s*x?\s*([a-z][a-z\s\-]+)/);
    if (qtyMatch) {
      const qty = qtyMatch[1];
      const itemRaw = qtyMatch[2].trim();
      const itemName = itemRaw.replace(/\bof\b/g, "").trim();

      const currentItems = [...(note.items || [])];
      const idx = currentItems.findIndex((it) => it.toLowerCase().includes(itemName));
      if (idx >= 0) {
        currentItems[idx] = `${itemName} x${qty}`;
      } else if (itemName) {
        currentItems.push(`${itemName} x${qty}`);
      }
      updates = { items: currentItems };
      bullets.push(`Got it — added ${qty} ${itemName}. Anything else for groceries?`);
    }

    if (!bullets.length) {
      bullets.push("Consider adding quantities and brands to your grocery items for faster shopping.");
    }
  }

  // Generic helpers by category
  if (note.category === "Task") {
    if (/prioriti|first|start/.test(lower)) bullets.push("Start with a 5‑minute action to build momentum.");
    bullets.push("Break the task into smaller steps and set a due date.");
  }
  if (note.category === "Home Improvement") {
    bullets.push("Gather materials first and plan the work in 1–2 hour blocks.");
  }
  if (note.category === "Travel Idea") {
    bullets.push("Save spots in a list and check flight alerts for price drops.");
  }
  if (note.category === "Date Idea") {
    bullets.push("Add a budget and time window to make it easier to schedule.");
  }

  // Suggestions
  if (lower.includes("suggest") || lower.includes("idea")) {
    bullets.push("I can create a checklist from this note — want me to do that?");
  }

  const reply = [replyStart, ...bullets.map((b) => `• ${b}`)].join(" \n\n");
  return { reply, updates };
}

// Backward-compatible wrapper used elsewhere
export async function generateOliveReply(note: Note, userMessage: string): Promise<string> {
  const { reply } = await assistWithNote(note, userMessage);
  return reply;
}
