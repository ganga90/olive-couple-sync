import React, { useState, useRef, useEffect, useMemo } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/providers/AuthProvider";
import { useSupabaseCouple } from "@/providers/SupabaseCoupleProvider";
import { supabase } from "@/lib/supabaseClient";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { useSupabaseNotes, type SupabaseNote } from "@/hooks/useSupabaseNotes";
import { useSupabaseLists, type SupabaseList } from "@/hooks/useSupabaseLists";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AskOliveChatGlobalProps {
  onClose?: () => void;
}

// Helper function to format user's saved data into context for the AI
const formatUserContextForAI = (
  notes: SupabaseNote[],
  lists: SupabaseList[]
): string => {
  if (notes.length === 0 && lists.length === 0) {
    return "";
  }

  const contextParts: string[] = [];

  // Group notes by list
  const notesByList = new Map<string | null, SupabaseNote[]>();
  const notesWithoutList: SupabaseNote[] = [];

  notes.forEach((note) => {
    if (note.list_id) {
      const existing = notesByList.get(note.list_id) || [];
      existing.push(note);
      notesByList.set(note.list_id, existing);
    } else {
      notesWithoutList.push(note);
    }
  });

  // Format lists with their items
  if (lists.length > 0) {
    contextParts.push("USER'S LISTS AND SAVED ITEMS:");

    lists.forEach((list) => {
      const listNotes = notesByList.get(list.id) || [];
      if (listNotes.length > 0) {
        const itemsSummary = listNotes
          .slice(0, 20) // Limit to 20 items per list
          .map((note) => {
            // Prefer summary, fall back to original_text
            const content = note.summary || note.original_text;
            const truncated = content.length > 100 ? content.slice(0, 100) + "..." : content;
            const status = note.completed ? " [COMPLETED]" : "";
            const priority = note.priority && note.priority !== 'low' ? ` [${note.priority.toUpperCase()}]` : "";
            return `  - ${truncated}${status}${priority}`;
          })
          .join("\n");

        contextParts.push(`\n📋 ${list.name}${list.description ? ` (${list.description})` : ""}:`);
        contextParts.push(itemsSummary);

        if (listNotes.length > 20) {
          contextParts.push(`  ... and ${listNotes.length - 20} more items`);
        }
      } else {
        // Show empty lists too
        contextParts.push(`\n📋 ${list.name}${list.description ? ` (${list.description})` : ""}: (no items yet)`);
      }
    });
  }

  // Format notes without lists by category
  if (notesWithoutList.length > 0) {
    const notesByCategory = new Map<string, SupabaseNote[]>();

    notesWithoutList.forEach((note) => {
      const category = note.category || "general";
      const existing = notesByCategory.get(category) || [];
      existing.push(note);
      notesByCategory.set(category, existing);
    });

    if (notesByCategory.size > 0) {
      contextParts.push("\nUSER'S OTHER NOTES BY CATEGORY:");

      notesByCategory.forEach((categoryNotes, category) => {
        const formattedCategory = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        contextParts.push(`\n📝 ${formattedCategory}:`);

        categoryNotes.slice(0, 10).forEach((note) => {
          const content = note.summary || note.original_text;
          const truncated = content.length > 100 ? content.slice(0, 100) + "..." : content;
          const status = note.completed ? " [COMPLETED]" : "";
          const priority = note.priority && note.priority !== 'low' ? ` [${note.priority.toUpperCase()}]` : "";
          const dueDate = note.due_date ? ` [Due: ${new Date(note.due_date).toLocaleDateString()}]` : "";
          contextParts.push(`  - ${truncated}${status}${priority}${dueDate}`);
        });

        if (categoryNotes.length > 10) {
          contextParts.push(`  ... and ${categoryNotes.length - 10} more items`);
        }
      });
    }
  }

  // Add task statistics
  const activeTasks = notes.filter((n) => !n.completed);
  const completedTasks = notes.filter((n) => n.completed);
  const urgentTasks = notes.filter((n) => n.priority === "high" && !n.completed);
  const overdueTasks = notes.filter((n) => {
    if (!n.due_date || n.completed) return false;
    return new Date(n.due_date) < new Date();
  });
  const dueTodayTasks = notes.filter((n) => {
    if (!n.due_date || n.completed) return false;
    const dueDate = new Date(n.due_date);
    const today = new Date();
    return dueDate.toDateString() === today.toDateString();
  });

  if (activeTasks.length > 0 || completedTasks.length > 0) {
    contextParts.push("\nTASK STATISTICS:");
    contextParts.push(`- Total items: ${notes.length}`);
    contextParts.push(`- Active: ${activeTasks.length}`);
    contextParts.push(`- Completed: ${completedTasks.length}`);
    if (urgentTasks.length > 0) {
      contextParts.push(`- Urgent/High priority: ${urgentTasks.length}`);
    }
    if (overdueTasks.length > 0) {
      contextParts.push(`- Overdue: ${overdueTasks.length}`);
    }
    if (dueTodayTasks.length > 0) {
      contextParts.push(`- Due today: ${dueTodayTasks.length}`);
    }
  }

  return contextParts.join("\n");
};

const AskOliveChatGlobal: React.FC<AskOliveChatGlobalProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { user } = useAuth();
  const { currentCouple, you } = useSupabaseCouple();
  const { t } = useTranslation("common");

  // Fetch user's notes and lists for context
  const { notes, loading: notesLoading } = useSupabaseNotes(currentCouple?.id);
  const { lists, loading: listsLoading } = useSupabaseLists(currentCouple?.id);

  // Memoize the formatted context to avoid recalculating on every render
  const userContext = useMemo(() => {
    if (notesLoading || listsLoading) return "";
    return formatUserContextForAI(notes, lists);
  }, [notes, lists, notesLoading, listsLoading]);

  // Initial greeting
  useEffect(() => {
    const displayName = String(
      you || user?.fullName || user?.firstName || user?.username || ""
    ).trim();

    const greeting: Message = {
      id: "greeting",
      role: "assistant",
      content: displayName
        ? t("askOlive.greetingWithName", {
            name: displayName,
            defaultValue: `Hi ${displayName}! 👋 How can I help you today? I can help with tasks, planning, reminders, or just chat about anything.`,
          })
        : t("askOlive.greetingNoName", {
            defaultValue:
              "Hi! 👋 How can I help you today? I can help with tasks, planning, reminders, or just chat about anything.",
          }),
      timestamp: new Date(),
    };
    setMessages([greeting]);
  }, [you, user, t]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!input.trim() || !user || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Build conversation history for multi-turn context
      const conversationHistory = messages
        .filter((m) => m.id !== "greeting")
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      const { data, error } = await supabase.functions.invoke("ask-olive-individual", {
        body: {
          // ask-olive-individual expects these fields for legacy support
          noteContent: "",
          noteCategory: "general",
          noteTitle: "Global chat",
          userMessage: userMessage.content,
          previousInteractionId: interactionId,
          user_id: user.id,
          // New global chat context
          message: userMessage.content,
          couple_id: currentCouple?.id,
          context: {
            source: "global_chat",
            user_name: you,
            // Include the user's saved data as context
            saved_items_context: userContext,
            // Include conversation history for multi-turn
            conversation_history: conversationHistory,
          },
        },
      });

      if (error) throw error;

      // Persist interaction ID (for multi-turn continuity)
      if (data?.interactionId) {
        setInteractionId(String(data.interactionId));
      }

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content:
          data?.reply ||
          data?.response ||
          t("askOlive.error", "I'm having trouble responding right now. Please try again."),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Ask Olive error:", error);
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: t("askOlive.connectionError", "Sorry, I'm having trouble connecting right now. Please try again."),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-[60vh] max-h-[500px]">
      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="space-y-4 py-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted text-foreground rounded-bl-md"
                )}
              >
                {message.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mb-2 [&>ol]:mb-2">
                    <ReactMarkdown>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  <span className="text-sm">{t("askOlive.thinking", "Thinking...")}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("askOlive.placeholder", "Ask me anything...")}
            className="min-h-[44px] max-h-32 resize-none text-base"
            rows={1}
            disabled={isLoading}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="h-11 w-11 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AskOliveChatGlobal;
