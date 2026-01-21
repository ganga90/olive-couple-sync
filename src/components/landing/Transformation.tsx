import { useTranslation } from "react-i18next";
import { useState } from "react";
import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Transformation = () => {
  const { t } = useTranslation('landing');
  const [showAfter, setShowAfter] = useState(false);

  const beforeItems = [
    "transformation.before.item1",
    "transformation.before.item2",
    "transformation.before.item3",
    "transformation.before.item4",
  ];

  const afterItems = [
    "transformation.after.item1",
    "transformation.after.item2",
    "transformation.after.item3",
    "transformation.after.item4",
  ];

  return (
    <section className="bg-[#EAE8E0] py-20 md:py-28 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-5xl font-serif text-stone-900 mb-4">
            {t('transformation.headline')}
          </h2>
        </motion.div>

        {/* Toggle Switch */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex justify-center mb-12"
        >
          <div className="bg-white rounded-full p-1 shadow-md inline-flex">
            <button
              onClick={() => setShowAfter(false)}
              className={cn(
                "px-6 py-3 rounded-full text-sm font-medium transition-all duration-300",
                !showAfter 
                  ? "bg-stone-800 text-white" 
                  : "text-stone-600 hover:text-stone-800"
              )}
            >
              {t('transformation.toggleBefore')}
            </button>
            <button
              onClick={() => setShowAfter(true)}
              className={cn(
                "px-6 py-3 rounded-full text-sm font-medium transition-all duration-300",
                showAfter 
                  ? "bg-primary text-primary-foreground" 
                  : "text-stone-600 hover:text-stone-800"
              )}
            >
              {t('transformation.toggleAfter')}
            </button>
          </div>
        </motion.div>

        {/* Comparison Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="relative"
        >
          <div 
            className={cn(
              "bg-white rounded-3xl shadow-xl p-8 md:p-12 transition-all duration-500",
              showAfter ? "border-2 border-primary" : "border-2 border-stone-200"
            )}
          >
            <div className="space-y-6">
              {(showAfter ? afterItems : beforeItems).map((itemKey, index) => (
                <motion.div
                  key={`${showAfter}-${index}`}
                  initial={{ opacity: 0, x: showAfter ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-start gap-4"
                >
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                    showAfter ? "bg-primary/10" : "bg-stone-100"
                  )}>
                    {showAfter ? (
                      <Check className="h-5 w-5 text-primary" />
                    ) : (
                      <X className="h-5 w-5 text-stone-400" />
                    )}
                  </div>
                  <p className={cn(
                    "text-lg",
                    showAfter ? "text-stone-800" : "text-stone-500"
                  )}>
                    {t(itemKey)}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Bottom tag */}
            <div className="mt-8 pt-6 border-t border-stone-100 text-center">
              <span className={cn(
                "text-sm font-medium px-4 py-2 rounded-full",
                showAfter 
                  ? "bg-primary/10 text-primary" 
                  : "bg-stone-100 text-stone-500"
              )}>
                {showAfter ? t('transformation.tagAfter') : t('transformation.tagBefore')}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
