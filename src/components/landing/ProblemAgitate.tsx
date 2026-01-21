import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Layers, Brain, ArrowDown } from "lucide-react";
import { motion } from "framer-motion";

const problems = [
  {
    icon: RefreshCw,
    titleKey: "problems.nagging.title",
    descKey: "problems.nagging.description",
  },
  {
    icon: Layers,
    titleKey: "problems.scattered.title", 
    descKey: "problems.scattered.description",
  },
  {
    icon: Brain,
    titleKey: "problems.mentalLoad.title",
    descKey: "problems.mentalLoad.description",
  },
];

export const ProblemAgitate = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="problems" className="bg-white py-20 md:py-28 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-serif text-stone-900 mb-4">
            {t('problems.headline')}
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 md:gap-8">
          {problems.map((problem, index) => {
            const IconComponent = problem.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
              >
                <Card className="border-stone-200 shadow-sm hover:shadow-lg transition-all duration-300 h-full">
                  <CardContent className="p-8 text-center space-y-4">
                    <div className="w-16 h-16 mx-auto rounded-full bg-stone-100 flex items-center justify-center">
                      <IconComponent className="h-8 w-8 text-stone-500" />
                    </div>
                    <h3 className="text-xl font-semibold text-stone-900">
                      {t(problem.titleKey)}
                    </h3>
                    <p className="text-stone-600 leading-relaxed">
                      {t(problem.descKey)}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Transition Arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="flex justify-center mt-16"
        >
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ArrowDown className="h-6 w-6 text-primary animate-bounce" />
          </div>
        </motion.div>
      </div>
    </section>
  );
};
