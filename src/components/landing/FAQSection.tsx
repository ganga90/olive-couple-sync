import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";

const faqs = [
  {
    question: "Do I need to format notes?",
    answer: "No, free-form. Just dump whatever's on your mind—Olive handles all the organization, categorization, and structuring automatically."
  },
  {
    question: "Will Olive guess wrong?",
    answer: "You can confirm/adjust; Olive learns preferences. The AI gets better over time as it learns how you and your partner organize tasks and assign ownership."
  },
  {
    question: "How do owners work?",
    answer: "Uses your names; you can change per task. Olive automatically detects who should handle what based on context, but you can always reassign tasks manually."
  },
  {
    question: "Is my data private and secure?",
    answer: "Yes. We use Clerk for authentication and Supabase for secure data storage. Your notes are encrypted and only accessible by you and your partner."
  },
  {
    question: "Can I keep some notes private?",
    answer: "Yes, toggle Private/Shared. You can mark any note as private so only you can see it, while keeping shared notes visible to both partners."
  },
  {
    question: "Can I export my data?",
    answer: "Yes. You can export your tasks to popular calendar apps (Google Calendar, Apple Calendar) and download your notes in standard formats."
  },
  {
    question: "What platforms do you support?",
    answer: "Olive works in any web browser on desktop and mobile. We're planning native mobile apps based on user feedback during beta."
  },
  {
    question: "What's on your roadmap?",
    answer: "Native mobile apps, advanced recurring task patterns, integration with more calendar and productivity apps, and enhanced AI capabilities based on user feedback."
  }
];

export const FAQSection = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="mb-16">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Frequently asked questions
        </h2>
        <p className="text-xl text-gray-600">Everything you need to know about Olive</p>
      </div>

      <div className="max-w-3xl mx-auto space-y-4">
        {faqs.map((faq, index) => (
          <Card key={index} className="border border-gray-200 hover:border-olive/30 transition-colors">
            <CardContent className="p-0">
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <h3 className="text-lg font-medium text-gray-900 pr-4">{faq.question}</h3>
                {openIndex === index ? (
                  <ChevronDown className="h-5 w-5 text-olive flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                )}
              </button>
              
              {openIndex === index && (
                <div className="px-6 pb-6 animate-in slide-in-from-top duration-200">
                  <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};