import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Send, Sparkles, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface SimpleNoteInputProps {
  onNoteAdded?: () => void;
}

interface ProcessedNote {
  summary: string;
  category: string;
  priority: string;
  tags: string[];
  items: string[];
  due_date?: string;
}

export const SimpleNoteInput: React.FC<SimpleNoteInputProps> = ({ onNoteAdded }) => {
  const [text, setText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedNote, setProcessedNote] = useState<ProcessedNote | null>(null);
  const [showResult, setShowResult] = useState(false);

  const simulateAIProcessing = async (noteText: string): Promise<ProcessedNote> => {
    // Simulate AI processing with realistic delay
    await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
    
    // Simple rule-based categorization for demo
    const lowerText = noteText.toLowerCase();
    let category = "general";
    let priority = "medium";
    
    // Check for food/grocery items first (more specific)
    if (lowerText.includes("grocery") || lowerText.includes("groceries") || 
        /\b(milk|eggs|bread|lemons?|apples?|bananas?|cheese|butter|yogurt|vegetables?|fruits?|meat|chicken|beef|fish|rice|pasta|cereal|juice|coffee|tea|sugar|flour|onions?|tomatoes?|potatoes?|carrots?)\b/.test(lowerText)) {
      category = "groceries";
    } else if (lowerText.includes("shopping") || lowerText.includes("buy")) {
      category = "shopping";
    } else if (lowerText.includes("date") || lowerText.includes("dinner") || lowerText.includes("movie")) {
      category = "dateIdeas";
    } else if (lowerText.includes("fix") || lowerText.includes("repair") || lowerText.includes("clean")) {
      category = "chores";
    } else if (lowerText.includes("urgent") || lowerText.includes("asap") || lowerText.includes("important")) {
      priority = "high";
      category = "tasks";
    }
    
    // Extract potential items from text
    const items = noteText.split(/[,\n]/).map(item => item.trim()).filter(item => item.length > 0);
    
    // Generate summary
    const summary = noteText.length > 50 ? 
      noteText.substring(0, 50) + "..." : 
      noteText;
    
    // Extract tags
    const tags = [];
    if (lowerText.includes("weekend")) tags.push("weekend");
    if (lowerText.includes("urgent")) tags.push("urgent");
    if (lowerText.includes("important")) tags.push("important");
    
    return {
      summary,
      category,
      priority,
      tags,
      items: items.slice(0, 5), // Limit to 5 items
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) {
      toast.error("Please enter a note");
      return;
    }

    setIsProcessing(true);
    setShowResult(false);
    
    try {
      const processed = await simulateAIProcessing(text.trim());
      setProcessedNote(processed);
      setShowResult(true);
      onNoteAdded?.();
      toast.success("Note organized by AI!");
    } catch (error) {
      console.error("Error processing note:", error);
      toast.error("Failed to process note. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddAnother = () => {
    setText("");
    setProcessedNote(null);
    setShowResult(false);
  };

  // Dynamic placeholder based on day/time
  const getDynamicPlaceholder = () => {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    
    // Weekend suggestions
    if (day === 0 || day === 6) {
      return "Weekend plans, errands, or fun activities...";
    }
    
    // Morning suggestions
    if (hour < 12) {
      return "Morning tasks, groceries, or today's priorities...";
    }
    
    // Afternoon suggestions
    if (hour < 18) {
      return "Afternoon goals, errands, or evening plans...";
    }
    
    // Evening suggestions
    return "Tomorrow's prep, shopping lists, or date ideas...";
  };

  if (showResult && processedNote) {
    return (
      <div className="space-y-4">
        <Card className="bg-gradient-soft border-olive/20 shadow-soft">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-olive">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Note organized!</span>
            </div>
            
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Original Note:</h4>
                <p className="text-foreground bg-background/50 p-3 rounded-lg mt-1">{text}</p>
              </div>
              
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">AI Summary:</h4>
                <p className="text-foreground mt-1">{processedNote.summary}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Category:</h4>
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-olive/10 text-olive text-sm mt-1">
                    {processedNote.category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  </span>
                </div>
                
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Priority:</h4>
                  <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm mt-1 ${
                    processedNote.priority === 'high' ? 'bg-red-100 text-red-700' :
                    processedNote.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-700'
                  }`}>
                    {processedNote.priority}
                  </span>
                </div>
              </div>
              
              {processedNote.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Tags:</h4>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {processedNote.tags.map((tag, index) => (
                      <span key={index} className="inline-flex items-center px-2 py-1 rounded-md bg-background text-foreground text-xs">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {processedNote.items.length > 1 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Items Detected:</h4>
                  <ul className="mt-1 space-y-1">
                    {processedNote.items.map((item, index) => (
                      <li key={index} className="text-sm text-foreground flex items-center gap-2">
                        <span className="w-1 h-1 bg-olive rounded-full"></span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
        
        <Button 
          onClick={handleAddAnother}
          className="w-full bg-gradient-olive text-white shadow-olive"
        >
          Add Another Note
        </Button>
      </div>
    );
  }

  return (
    <Card className="bg-gradient-soft border-olive/20 shadow-soft">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Drop task or thought here
          </h2>
          <p className="text-sm text-muted-foreground">
            I'll organize it for you with AI
          </p>
        </div>
        
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={getDynamicPlaceholder()}
            className="min-h-[120px] border-olive/30 focus:border-olive resize-none text-base"
            disabled={isProcessing}
          />
          
          {text.trim() && (
            <div className="absolute bottom-3 right-3">
              <Button
                type="submit"
                size="sm"
                disabled={isProcessing || !text.trim()}
                className="bg-gradient-olive hover:bg-olive text-white shadow-olive"
              >
                {isProcessing ? (
                  <Sparkles className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>
        
        <p className="text-xs text-center text-muted-foreground">
          {isProcessing ? "AI is organizing your note..." : "I'll automatically categorize, summarize, and organize your note"}
        </p>
      </form>
    </Card>
  );
};