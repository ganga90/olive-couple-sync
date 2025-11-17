import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Clock, MessageSquare, ExternalLink, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { OliveLogo } from "@/components/OliveLogo";
import { assistWithNote } from "@/utils/oliveAssistant";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import ReactMarkdown from 'react-markdown';

interface RecentTasksSectionProps {
  title: string;
  tasks: any[];
  emptyMessage: string;
  icon: React.ReactNode;
}

export const RecentTasksSection: React.FC<RecentTasksSectionProps> = ({
  title,
  tasks,
  emptyMessage,
  icon,
}) => {
  const navigate = useNavigate();
  const { updateNote } = useSupabaseNotesContext();
  const [chatOpen, setChatOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<any>(null);
  const [messages, setMessages] = useState<{ role: "assistant" | "user"; content: string }[]>([]);
  const [input, setInput] = useState("");

  const handleTaskClick = (taskId: string) => {
    navigate(`/notes/${taskId}`);
  };

  const handleListClick = (listId: string) => {
    navigate(`/lists/${listId}`);
  };

  const handleAskOlive = (task: any) => {
    setCurrentTask(task);
    setMessages([
      { role: "assistant", content: `Hi! How can I help with "${task.summary}"?` }
    ]);
    setChatOpen(true);
  };

  const handleCompleteTask = async (task: any) => {
    try {
      await updateNote(task.id, { completed: !task.completed });
      toast.success(task.completed ? "Task marked as incomplete" : "Task completed!");
    } catch (error) {
      console.error("Error updating task:", error);
      toast.error("Failed to update task");
    }
  };

  const onSend = async () => {
    if (!input.trim() || !currentTask) return;

    const newMessages = [...messages, { role: "user" as const, content: input }];
    setMessages(newMessages);
    setInput("");

    try {
      const { reply, updates } = await assistWithNote(currentTask, input, supabase);
      
      if (updates && Object.keys(updates).length > 0) {
        await updateNote(currentTask.id, updates);
      }
      
      setMessages([...newMessages, { role: "assistant" as const, content: reply }]);
    } catch (error) {
      console.error("Error getting assistance:", error);
      setMessages([...newMessages, { 
        role: "assistant" as const, 
        content: "Sorry, I'm having trouble connecting right now. Please try again later." 
      }]);
    }
  };

  return (
    <Card className="bg-white/50 border-olive/20 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg text-olive-dark">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <div
              key={task.id}
              className="p-3 bg-white/70 border border-olive/10 rounded-lg hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => handleTaskClick(task.id)}
                    className="text-left w-full hover:text-olive transition-colors"
                  >
                    <h4 className="font-medium text-sm text-olive-dark truncate">
                      {task.summary}
                    </h4>
                  </button>
                  
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="secondary" className="bg-olive/10 text-olive border-olive/20 text-xs">
                      {task.category}
                    </Badge>
                    
                    {task.priority && (
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          task.priority === 'high' 
                            ? 'border-destructive/30 text-destructive bg-destructive/5'
                            : task.priority === 'medium'
                            ? 'border-yellow-500/30 text-yellow-600 bg-yellow-50'
                            : 'border-green-500/30 text-green-600 bg-green-50'
                        }`}
                      >
                        {task.priority}
                      </Badge>
                    )}
                    
                    {task.list_name && (
                      <button
                        onClick={() => handleListClick(task.list_id)}
                        className="text-xs text-muted-foreground hover:text-olive transition-colors flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {task.list_name}
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>By {task.addedBy}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(task.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
                 
                 <div className="flex items-center gap-2">
                   <Button
                     onClick={() => handleCompleteTask(task)}
                     variant="outline"
                     size="sm"
                     className={`border-olive/30 text-olive hover:bg-olive/10 flex items-center gap-1 ${
                       task.completed ? 'bg-olive/10' : ''
                     }`}
                   >
                     <CheckCircle className={`h-3 w-3 ${task.completed ? 'fill-olive' : ''}`} />
                   </Button>
                   <Button
                     onClick={() => handleAskOlive(task)}
                     variant="outline"
                     size="sm"
                     className="border-olive/30 text-olive hover:bg-olive/10 flex items-center gap-1"
                   >
                     <OliveLogo size={12} />
                     <MessageSquare className="h-3 w-3" />
                   </Button>
                 </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">{emptyMessage}</p>
          </div>
        )}
      </CardContent>
      
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="bg-white border-olive/20 shadow-soft">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-olive-dark">
              <OliveLogo size={20} />
              Olive Assistant
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-md bg-olive/5 border border-olive/10 p-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div className={
                  m.role === "user"
                    ? "inline-block rounded-lg bg-olive text-white px-3 py-2 shadow-soft"
                    : "inline-block rounded-lg bg-white border border-olive/20 px-3 py-2 text-olive-dark shadow-soft"
                }>
                  {m.role === "user" ? (
                    m.content
                  ) : (
                    <ReactMarkdown 
                      components={{
                        ul: ({children}) => <ul className="list-disc pl-4 space-y-1 text-sm">{children}</ul>,
                        li: ({children}) => <li className="text-sm">{children}</li>,
                        strong: ({children}) => <strong className="font-semibold text-olive-dark">{children}</strong>,
                        p: ({children}) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question..."
              rows={3}
              className="border-olive/30 focus:border-olive focus:ring-olive/20"
            />
            <DialogFooter>
              <Button 
                onClick={onSend}
                className="bg-olive hover:bg-olive/90 text-white"
              >
                Send
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};