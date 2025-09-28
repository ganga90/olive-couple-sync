import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Users, MessageSquare, Calendar, ArrowRight, CheckCircle, Link2, Mic } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Raw note → Structured plan",
    description: "Auto-category (Lists), Owners, Dates, Recurring patterns.",
    badge: "Works with voice, too",
    details: [
      "Automatically detects task ownership",
      "Extracts due dates and deadlines", 
      "Creates and updates lists intelligently",
      "Identifies recurring patterns"
    ],
    color: "olive"
  },
  {
    icon: Users,
    title: "Shared Space for Two",
    description: "Invite partner with one link, everything stays in sync.",
    badge: "Real-time sync",
    details: [
      "One-click partner invitation",
      "Instant synchronization across devices",
      "Shared and private note options",
      "Combined calendar view"
    ],
    color: "rose"
  },
  {
    icon: MessageSquare,
    title: "Ask Olive (context-aware help)",
    description: "Get intelligent suggestions based on your notes and context.",
    badge: "AI-powered",
    details: [
      "Turn notes into actionable checklists",
      "Draft messages and reminders",
      "Generate itineraries from your plans",
      "Smart suggestions for next steps"
    ],
    color: "blue"
  },
  {
    icon: Calendar,
    title: "Calendar view",
    description: "All your dated tasks and events in one place—shared.",
    badge: "Export to calendar",
    details: [
      "Unified view of all dated items",
      "Export to Google Calendar/Apple",
      "Shared calendar for couples",
      "Smart date detection"
    ],
    color: "purple"
  }
];

const askOliveExamples = [
  "Turn this into a packing checklist.",
  "Draft a text to remind you about the bills.",  
  "Suggest a 7-day Madrid itinerary from our notes."
];

const colorClasses = {
  olive: "bg-olive/10 text-olive border-olive/20",
  rose: "bg-rose-100 text-rose-600 border-rose-200", 
  blue: "bg-blue-100 text-blue-600 border-blue-200",
  purple: "bg-purple-100 text-purple-600 border-purple-200"
};

export const FeatureSections = () => {
  return (
    <section className="mb-16 space-y-12">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Your AI superpower for life organization
        </h2>
        <p className="text-xl text-gray-600">Everything you need to turn chaos into clarity</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {features.map((feature, index) => {
          const IconComponent = feature.icon;
          
          return (
            <Card key={index} className="border-0 shadow-lg bg-white hover:shadow-xl transition-all duration-300 group">
              <CardContent className="p-8">
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${colorClasses[feature.color]}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {feature.badge === "Works with voice, too" && <Mic className="mr-1 h-3 w-3" />}
                      {feature.badge === "Real-time sync" && <Link2 className="mr-1 h-3 w-3" />}
                      {feature.badge}
                    </Badge>
                  </div>
                  
                  <h3 className="text-xl font-semibold text-gray-900 group-hover:text-olive transition-colors">
                    {feature.title}
                  </h3>
                  
                  <p className="text-gray-600 leading-relaxed">
                    {feature.description}
                  </p>

                  <div className="space-y-2">
                    {feature.details.map((detail, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-600">
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        <span>{detail}</span>
                      </div>
                    ))}
                  </div>

                  {feature.title.includes("Ask Olive") && (
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-medium text-gray-700 mb-2">Examples:</p>
                      <div className="space-y-2">
                        {askOliveExamples.map((example, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <MessageSquare className="h-3 w-3 text-blue-500 flex-shrink-0" />
                            <span className="text-sm text-gray-600">"{example}"</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
};