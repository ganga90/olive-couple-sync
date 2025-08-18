import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Calendar, User, Tag, List, Sparkles } from "lucide-react";
import { format } from "date-fns";

interface NoteRecapProps {
  note: {
    summary: string;
    category: string;
    dueDate?: string | null;
    priority?: "low" | "medium" | "high";
    tags?: string[];
    items?: string[];
    originalText: string;
    author: string;
    createdAt: string;
  };
  onClose?: () => void;
}

export const NoteRecap: React.FC<NoteRecapProps> = ({ note, onClose }) => {
  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case "high": return "bg-red-100 text-red-800 border-red-200";
      case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "low": return "bg-green-100 text-green-800 border-green-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "groceries": return "bg-green-100 text-green-800 border-green-200";
      case "shopping": return "bg-blue-100 text-blue-800 border-blue-200";
      case "dateIdeas": return "bg-pink-100 text-pink-800 border-pink-200";
      case "homeImprovement": return "bg-orange-100 text-orange-800 border-orange-200";
      case "travel": return "bg-purple-100 text-purple-800 border-purple-200";
      case "reminder": return "bg-amber-100 text-amber-800 border-amber-200";
      case "personal": return "bg-indigo-100 text-indigo-800 border-indigo-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <Card className="bg-gradient-to-br from-olive/5 to-olive/10 border-olive/20 shadow-soft">
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-olive" />
            <h3 className="text-lg font-semibold text-foreground">Note Organized!</h3>
          </div>
          <Sparkles className="h-5 w-5 text-olive animate-pulse" />
        </div>

        {/* Summary */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">AI Summary</h4>
          <p className="text-base font-medium text-foreground">{note.summary}</p>
        </div>

        {/* Category and Priority */}
        <div className="flex flex-wrap gap-2">
          <Badge className={getCategoryColor(note.category)}>
            {note.category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
          </Badge>
          {note.priority && (
            <Badge className={getPriorityColor(note.priority)}>
              {note.priority} priority
            </Badge>
          )}
        </div>

        {/* Items list */}
        {note.items && note.items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <List className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">Items</h4>
            </div>
            <ul className="space-y-1">
              {note.items.slice(0, 3).map((item, index) => (
                <li key={index} className="text-sm text-foreground flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-olive rounded-full"></span>
                  {item}
                </li>
              ))}
              {note.items.length > 3 && (
                <li className="text-sm text-muted-foreground">
                  +{note.items.length - 3} more items
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Tags */}
        {note.tags && note.tags.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-medium text-muted-foreground">Tags</h4>
            </div>
            <div className="flex flex-wrap gap-1">
              {note.tags.map((tag, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pt-4 border-t border-olive/20">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Added by {note.author}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>{format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
          </div>
          {note.dueDate && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>Due: {format(new Date(note.dueDate), "MMM d, yyyy")}</span>
            </div>
          )}
        </div>

        {/* Original text reference */}
        <div className="text-xs text-muted-foreground bg-white/50 p-3 rounded border border-olive/10">
          <strong>Original:</strong> "{note.originalText}"
        </div>
      </div>
    </Card>
  );
};