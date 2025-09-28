import { Card, CardContent } from "@/components/ui/card";
import { MessageSquareText, Sparkles, Users } from "lucide-react";

const steps = [
  {
    icon: MessageSquareText,
    title: "Dump it",
    description: "Type or speak anything. Don't format.",
    detail: "Just brain-dump whatever's on your mind—grocery lists, travel plans, random thoughts, or complex projects.",
    color: "blue"
  },
  {
    icon: Sparkles,
    title: "Olive organizes", 
    description: "Extracts tasks, owners, dates, and lists automatically.",
    detail: "AI instantly categorizes your notes, assigns tasks to the right person, detects due dates, and creates organized lists.",
    color: "olive"
  },
  {
    icon: Users,
    title: "Sync & ask",
    description: "Shared space for both of you. Ask Olive for next steps, summaries, or suggestions.",
    detail: "Everything stays in sync between partners. Ask Olive for help with planning, reminders, or breaking down complex tasks.",
    color: "purple"
  }
];

const colorClasses = {
  blue: "bg-blue-100 text-blue-600 border-blue-200",
  olive: "bg-olive/10 text-olive border-olive/20", 
  purple: "bg-purple-100 text-purple-600 border-purple-200"
};

export const HowItWorks = () => {
  return (
    <section className="mb-16">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">How Olive works</h2>
        <p className="text-xl text-gray-600">Three simple steps to organized life</p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        {steps.map((step, index) => {
          const IconComponent = step.icon;
          return (
            <Card key={index} className="relative border-0 shadow-lg bg-white hover:shadow-xl transition-all duration-300">
              <CardContent className="p-8 text-center space-y-4">
                <div className="relative">
                  <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${colorClasses[step.color]}`}>
                    <IconComponent className="h-8 w-8" />
                  </div>
                  <div className="absolute -top-2 -right-2 bg-gray-900 text-white text-sm font-bold w-6 h-6 rounded-full flex items-center justify-center">
                    {index + 1}
                  </div>
                </div>
                
                <h3 className="text-xl font-semibold text-gray-900">{step.title}</h3>
                <p className="text-gray-600 font-medium">{step.description}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{step.detail}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
};