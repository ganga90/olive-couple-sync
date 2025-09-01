import React from "react";
import { useNavigate } from "react-router-dom";
import { useSupabaseNotesContext } from "@/providers/SupabaseNotesProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, MessageSquare, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { OliveLogo } from "@/components/OliveLogo";
import { assistWithNote } from "@/utils/oliveAssistant";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

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

  const handleTaskClick = (taskId: string) => {
    navigate(`/note/${taskId}`);
  };

  const handleListClick = (listId: string) => {
    navigate(`/lists/${listId}`);
  };

  const handleAskOlive = async (task: any) => {
    try {
      const { reply, updates } = await assistWithNote(
        task,
        "Can you help me with this task?",
        supabase
      );
      
      if (updates && Object.keys(updates).length > 0) {
        await updateNote(task.id, updates);
      }
      
      toast.success("Olive's suggestion: " + reply.slice(0, 100) + "...");
    } catch (error) {
      console.error("Error asking Olive:", error);
      toast.error("Failed to get Olive's help");
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
          ))
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">{emptyMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};