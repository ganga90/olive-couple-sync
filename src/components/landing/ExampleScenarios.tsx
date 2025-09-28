import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plane, FileText, ShoppingCart, ArrowRight, Calendar, User, List } from "lucide-react";

const scenarios = [
  {
    icon: Plane,
    title: "Trip planning",
    input: "book flights to Madrid next month; remind Almu about passport; museum tickets?",
    results: {
      tasks: [
        { text: "Book flights to Madrid", owner: "You", due: "Next month" },
        { text: "Remind about passport renewal", owner: "Almu", due: "2 weeks" }
      ],
      calendar: [{ text: "Madrid trip planning", date: "Next month" }],
      suggestions: "Ask Olive suggests best days based on flight prices and weather"
    },
    color: "blue"
  },
  {
    icon: FileText,
    title: "Life admin",
    input: "rent due Friday; schedule car service; pay internet bill monthly",
    results: {
      tasks: [
        { text: "Pay rent", owner: "You", due: "Friday" },
        { text: "Schedule car service", owner: "You", due: "This week" },
        { text: "Pay internet bill", owner: "You", due: "Monthly recurring" }
      ],
      calendar: [{ text: "Rent payment", date: "Friday" }],
      suggestions: "Creates recurring series + reminder notifications"
    },
    color: "green"
  },
  {
    icon: ShoppingCart,
    title: "Groceries & meals", 
    input: "groceries tonight: salmon, spinach, lemons; cook Fri; Almu handles dessert",
    results: {
      tasks: [
        { text: "Cook dinner", owner: "You", due: "Friday" },
        { text: "Handle dessert", owner: "Almu", due: "Friday" }
      ],
      lists: [{ name: "Groceries", items: ["salmon", "spinach", "lemons"] }],
      suggestions: "List populated + owner assignments detected"
    },
    color: "orange"
  }
];

const colorClasses = {
  blue: "bg-blue-100 text-blue-600",
  green: "bg-green-100 text-green-600", 
  orange: "bg-orange-100 text-orange-600"
};

export const ExampleScenarios = () => {
  return (
    <section className="mb-16">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Real scenarios, real results
        </h2>
        <p className="text-xl text-gray-600">See how Olive transforms everyday brain-dumps</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {scenarios.map((scenario, index) => {
          const IconComponent = scenario.icon;
          
          return (
            <Card key={index} className="border-0 shadow-lg bg-white hover:shadow-xl transition-all duration-300">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${colorClasses[scenario.color]}`}>
                    <IconComponent className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{scenario.title}</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Brain-dump:</p>
                    <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 italic border-l-4 border-gray-300">
                      "{scenario.input}"
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-gray-400">
                    <ArrowRight className="h-4 w-4" />
                    <span className="text-xs font-medium">OLIVE ORGANIZES</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>

                  <div className="space-y-3">
                    {scenario.results.tasks && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <User className="h-4 w-4 text-blue-600" />
                          <span className="text-xs font-medium text-blue-800">TASKS CREATED</span>
                        </div>
                        <div className="space-y-1">
                          {scenario.results.tasks.map((task, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-gray-700">{task.text}</span>
                              <div className="flex gap-1">
                                <Badge variant="secondary" className="text-xs h-5">{task.owner}</Badge>
                                <Badge variant="outline" className="text-xs h-5">{task.due}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {scenario.results.calendar && (
                      <div className="bg-purple-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Calendar className="h-4 w-4 text-purple-600" />
                          <span className="text-xs font-medium text-purple-800">CALENDAR HOLDS</span>
                        </div>
                        {scenario.results.calendar.map((event, i) => (
                          <div key={i} className="text-xs text-gray-700">
                            {event.text} - {event.date}
                          </div>
                        ))}
                      </div>
                    )}

                    {scenario.results.lists && (
                      <div className="bg-green-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <List className="h-4 w-4 text-green-600" />
                          <span className="text-xs font-medium text-green-800">LISTS POPULATED</span>
                        </div>
                        {scenario.results.lists.map((list, i) => (
                          <div key={i} className="text-xs text-gray-700">
                            <span className="font-medium">{list.name}:</span> {list.items.join(", ")}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="bg-yellow-50 rounded-lg p-3 border-l-2 border-yellow-300">
                      <p className="text-xs text-yellow-800 font-medium">{scenario.results.suggestions}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
};