import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

const features = [
  {
    titleKey: "valueStack.brainDump.title",
    descKey: "valueStack.brainDump.description",
    imageAlt: "Brain Dump Input Screenshot",
    imagePlaceholder: "[SCREENSHOT OF BRAIN DUMP INPUT]",
  },
  {
    titleKey: "valueStack.whatsapp.title",
    descKey: "valueStack.whatsapp.description",
    imageAlt: "WhatsApp Integration Screenshot",
    imagePlaceholder: "[SCREENSHOT OF WHATSAPP CHAT]",
  },
  {
    titleKey: "valueStack.sharedReality.title",
    descKey: "valueStack.sharedReality.description",
    imageAlt: "Dashboard Screenshot",
    imagePlaceholder: "[SCREENSHOT OF DASHBOARD]",
  },
];

export const ValueStack = () => {
  const { t } = useTranslation('landing');

  return (
    <section className="bg-[#EAE8E0] py-20 md:py-28 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-serif text-stone-900 mb-4">
            {t('valueStack.headline')}
          </h2>
          <p className="text-xl text-stone-600 max-w-2xl mx-auto">
            {t('valueStack.subheadline')}
          </p>
        </motion.div>

        <div className="space-y-20 md:space-y-32">
          {features.map((feature, index) => {
            const isReversed = index % 2 === 1;
            
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6 }}
                className={`flex flex-col ${isReversed ? 'md:flex-row-reverse' : 'md:flex-row'} gap-8 md:gap-16 items-center`}
              >
                {/* Text Content */}
                <div className="flex-1 space-y-4 text-center md:text-left">
                  <h3 className="text-2xl md:text-4xl font-serif text-stone-900">
                    {t(feature.titleKey)}
                  </h3>
                  <p className="text-lg text-stone-600 leading-relaxed max-w-lg">
                    {t(feature.descKey)}
                  </p>
                </div>

                {/* Image Placeholder */}
                <div className="flex-1 w-full">
                  <div className="bg-white rounded-2xl shadow-xl border border-stone-200 p-6">
                    <div className="bg-stone-100 rounded-xl h-56 md:h-72 flex items-center justify-center">
                      <p className="text-stone-400 text-sm font-medium text-center px-4">
                        {feature.imagePlaceholder}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
