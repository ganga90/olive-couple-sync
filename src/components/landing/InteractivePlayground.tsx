import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User, List, Lightbulb, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const EXAMPLE_INPUTS = [
  "dinner with Luca next Wed 7pm—ask Almu to book a table",
  "Q3 OKRs draft Fri, send outline to Giulia", 
  "groceries: salmon, spinach, lemons; prep dinner Fri",
  "book flights to Madrid next month, remind Almu to renew passport, groceries for tonight"
];

const mockParse = (input: string) => {
  const lower = input.toLowerCase();
  const tasks = [];
  const lists = [];
  const calendar = [];
  
  // Mock parsing logic for demo
  if (lower.includes('dinner') && lower.includes('wed')) {
    tasks.push({ text: "Ask Almu to book table", owner: "You", due: "Today" });
    calendar.push({ text: "Dinner with Luca", date: "Next Wed 7pm" });
  }
  
  if (lower.includes('okr') || lower.includes('outline')) {
    tasks.push({ text: "Draft Q3 OKRs", owner: "You", due: "Friday" });
    tasks.push({ text: "Send outline to Giulia", owner: "You", due: "Friday" });
  }
  
  if (lower.includes('groceries') || lower.includes('salmon')) {
    lists.push({ 
      name: "Groceries", 
      items: lower.includes('salmon') ? ["salmon", "spinach", "lemons"] : ["tonight's items"]
    });
    if (lower.includes('prep dinner')) {
      tasks.push({ text: "Prep dinner", owner: "You", due: "Friday" });
    }
  }
  
  if (lower.includes('flights') || lower.includes('madrid')) {
    tasks.push({ text: "Book flights to Madrid", owner: "You", due: "Next month" });
  }
  
  if (lower.includes('passport')) {
    tasks.push({ text: "Renew passport", owner: "Almu", due: "2 weeks" });
  }
  
  return { tasks, lists, calendar };
};

export const InteractivePlayground = () => {
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);
  const [showConfidence, setShowConfidence] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = () => {
    if (!input.trim()) return;
    const parsed = mockParse(input);
    setResult(parsed);
  };

  const useExample = (example: string) => {
    setInput(example);
    setResult(null);
  };

  return (
    <section id="demo-playground" className="mb-16">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">See it in action</h2>
        <p className="text-xl text-gray-600">Try the playground below—no signup required</p>
      </div>

      <Card className="max-w-4xl mx-auto bg-white shadow-xl">
        <CardContent className="p-8">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type anything. Olive will do the organizing.
              </label>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Examples: trip planning, chores, reminders, groceries."
                className="min-h-[120px] text-lg"
                onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleSubmit()}
              />
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              <span className="text-sm text-gray-500">Try these examples:</span>
              {EXAMPLE_INPUTS.map((example, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  onClick={() => useExample(example)}
                  className="text-xs h-8"
                >
                  {example.length > 40 ? example.substring(0, 40) + "..." : example}
                </Button>
              ))}
            </div>

            <Button 
              onClick={handleSubmit} 
              disabled={!input.trim()}
              className="w-full bg-olive hover:bg-olive/90 text-white py-3 text-lg"
            >
              Watch Olive organize this
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>

            {result && (
              <div className="mt-8 space-y-4 animate-in slide-in-from-bottom duration-500">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">Olive organized this into:</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowConfidence(!showConfidence)}
                    className="text-olive hover:text-olive/80"
                  >
                    <Lightbulb className="mr-1 h-4 w-4" />
                    {showConfidence ? 'Hide' : 'Show'} how Olive decided
                  </Button>
                </div>

                <div className="grid gap-4">
                  {result.tasks.length > 0 && (
                    <Card className="border-l-4 border-l-blue-500">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <User className="h-4 w-4 text-blue-500" />
                          <span className="font-medium text-gray-900">New Tasks</span>
                        </div>
                        <div className="space-y-2">
                          {result.tasks.map((task, i) => (
                            <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                              <span className="text-gray-900">{task.text}</span>
                              <div className="flex gap-2">
                                <Badge variant="secondary">{task.owner}</Badge>
                                <Badge variant="outline">{task.due}</Badge>
                                {showConfidence && <Badge className="bg-green-100 text-green-800">95% confident</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {result.lists.length > 0 && (
                    <Card className="border-l-4 border-l-green-500">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <List className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-gray-900">Lists Updated</span>
                        </div>
                        {result.lists.map((list, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg p-3">
                            <span className="font-medium text-gray-900">{list.name}</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {list.items.map((item, j) => (
                                <Badge key={j} variant="outline" className="text-xs">
                                  {item}
                                  {showConfidence && <span className="ml-1 text-green-600">✓</span>}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {result.calendar.length > 0 && (
                    <Card className="border-l-4 border-l-purple-500">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Calendar className="h-4 w-4 text-purple-500" />
                          <span className="font-medium text-gray-900">Calendar Events</span>
                        </div>
                        {result.calendar.map((event, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg p-3">
                            <span className="text-gray-900">{event.text}</span>
                            <Badge variant="outline" className="ml-2">{event.date}</Badge>
                            {showConfidence && <Badge className="ml-2 bg-purple-100 text-purple-800">Auto-detected</Badge>}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="text-center pt-4">
                  <Button 
                    onClick={() => navigate("/sign-up")}
                    className="bg-olive hover:bg-olive/90 text-white px-8 py-3"
                  >
                    Create your space
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
};