import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Sparkles, Users, MessageSquare, Calendar, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const features = [
  {
    icon: Sparkles,
    text: "AI structuring & organization"
  },
  {
    icon: Calendar, 
    text: "Shared calendar view"
  },
  {
    icon: MessageSquare,
    text: "Ask Olive assistant"
  },
  {
    icon: Users,
    text: "Real-time couple sync"
  }
];

export const PricingSection = () => {
  const navigate = useNavigate();

  return (
    <section className="mb-16">
      <div className="text-center mb-12">
        <Badge variant="secondary" className="mb-4 bg-olive/10 text-olive border-olive/20">
          Limited Time
        </Badge>
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Free during beta
        </h2>
        <p className="text-xl text-gray-600">
          Get full access to all features while we're in beta
        </p>
      </div>

      <Card className="max-w-md mx-auto border-2 border-olive/20 shadow-xl bg-gradient-to-br from-white to-olive/5">
        <CardContent className="p-8 text-center space-y-6">
          <div>
            <div className="text-4xl font-bold text-gray-900 mb-2">Free</div>
            <p className="text-gray-600">During beta period</p>
          </div>

          <div className="space-y-4 text-left">
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              return (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-olive/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <IconComponent className="h-4 w-4 text-olive" />
                  </div>
                  <span className="text-gray-700">{feature.text}</span>
                </div>
              );
            })}
            
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Unlimited notes & lists</span>
            </div>
            
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Voice input support</span>
            </div>
            
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Export to calendar apps</span>
            </div>
          </div>

          <Button 
            size="lg" 
            onClick={() => navigate("/sign-up")}
            className="w-full bg-olive hover:bg-olive/90 text-white py-3 text-lg"
          >
            Try it free
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>

          <p className="text-xs text-gray-500">
            No credit card required • Start organizing in seconds
          </p>
        </CardContent>
      </Card>
    </section>
  );
};