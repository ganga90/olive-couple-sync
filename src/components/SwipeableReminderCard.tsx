import { useState, useRef } from "react";
import { useSwipeable } from "react-swipeable";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Calendar, Clock, Trash2, Edit } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { Note } from "@/types/note";

interface ReminderItem {
  note: Note;
  type: "explicit" | "auto-24h" | "auto-2h";
  time: Date;
  label: string;
}

interface SwipeableReminderCardProps {
  reminder: ReminderItem;
  onDelete: () => void;
  onEdit?: () => void;
  onClick: () => void;
}

export const SwipeableReminderCard = ({ 
  reminder, 
  onDelete, 
  onEdit, 
  onClick 
}: SwipeableReminderCardProps) => {
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const deleteThreshold = -80; // How far to swipe to trigger delete

  const handlers = useSwipeable({
    onSwiping: (eventData) => {
      if (eventData.dir === "Left") {
        setIsSwiping(true);
        const newOffset = Math.max(eventData.deltaX, deleteThreshold * 1.5);
        setOffset(newOffset);
      }
    },
    onSwiped: (eventData) => {
      setIsSwiping(false);
      if (eventData.dir === "Left" && offset < deleteThreshold) {
        // Swipe passed threshold - show delete button
        setOffset(deleteThreshold);
      } else {
        // Didn't swipe far enough - reset
        setOffset(0);
      }
    },
    onSwipedRight: () => {
      // Swipe right always closes
      setOffset(0);
    },
    trackMouse: false,
    trackTouch: true,
    delta: 10,
    preventScrollOnSwipe: false,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
    setOffset(0);
  };

  const handleCardClick = () => {
    if (offset !== 0) {
      // If swiped, clicking resets
      setOffset(0);
    } else {
      onClick();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-lg)]">
      {/* Delete button revealed by swipe */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end bg-destructive pr-4"
        style={{ width: Math.abs(deleteThreshold) + 20 }}
      >
        <button
          onClick={handleDelete}
          className="flex flex-col items-center justify-center text-destructive-foreground"
          aria-label="Delete reminder"
        >
          <Trash2 className="h-5 w-5" />
          <span className="text-xs font-medium mt-1">Delete</span>
        </button>
      </div>

      {/* Main card that slides */}
      <div
        {...handlers}
        ref={cardRef}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSwiping ? "none" : "transform 0.3s ease-out",
        }}
      >
        <Card 
          className="shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] transition-shadow cursor-pointer"
          onClick={handleCardClick}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                {/* Badges */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant={reminder.type === "explicit" ? "default" : "secondary"} className="text-xs">
                    {reminder.label}
                  </Badge>
                  {reminder.note.category && (
                    <Badge variant="outline" className="text-xs">
                      {reminder.note.category}
                    </Badge>
                  )}
                </div>
                
                {/* Title */}
                <h3 className="font-semibold text-base mb-2 line-clamp-2">
                  {reminder.note.summary}
                </h3>
                
                {/* Time details */}
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="font-medium text-foreground">
                      {format(reminder.time, "MMM d 'at' h:mm a")}
                    </span>
                    <span className="text-xs">
                      ({formatDistanceToNow(reminder.time, { addSuffix: true })})
                    </span>
                  </div>
                  
                  {reminder.note.dueDate && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>Due {format(new Date(reminder.note.dueDate), "MMM d 'at' h:mm a")}</span>
                    </div>
                  )}
                  
                  {reminder.note.recurrence_frequency && reminder.note.recurrence_frequency !== 'none' && (
                    <div className="flex items-center gap-2">
                      <Bell className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>Repeats {reminder.note.recurrence_frequency}</span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Action buttons - only show on desktop */}
              <div className="hidden md:flex gap-1 flex-shrink-0">
                {reminder.type === "explicit" && onEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                    aria-label="Edit reminder"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  aria-label="Delete reminder"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
