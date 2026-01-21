import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { BrainDumpDemo } from "./BrainDumpDemo";
import whatsappMockup from "@/assets/whatsapp-mockup.png";
import dashboardMockup from "@/assets/dashboard-mockup.png";

const features = [
  {
    titleKey: "valueStack.brainDump.title",
    descKey: "valueStack.brainDump.description",
    imageAlt: "Brain Dump Input Screenshot",
    showDemo: true,
  },
  {
    titleKey: "valueStack.whatsapp.title",
    descKey: "valueStack.whatsapp.description",
    imageAlt: "WhatsApp Integration Screenshot",
    image: whatsappMockup,
  },
  {
    titleKey: "valueStack.sharedReality.title",
    descKey: "valueStack.sharedReality.description",
    imageAlt: "Dashboard Screenshot",
    image: dashboardMockup,
  },
];

export const ValueStack = () => {
  const { t } = useTranslation('landing');

  return (
    <section id="features" className="bg-[#EAE8E0] py-20 md:py-28 px-4">
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

                {/* Image / Demo */}
                <div className="flex-1 w-full">
                  {feature.showDemo ? (
                    <BrainDumpDemo />
                  ) : feature.image ? (
                    <motion.div 
                      className="bg-white rounded-2xl shadow-xl border border-stone-200 p-4 md:p-6 overflow-hidden"
                      whileHover={{ scale: 1.02 }}
                      transition={{ duration: 0.3 }}
                    >
                      <img 
                        src={feature.image} 
                        alt={feature.imageAlt}
                        className="w-full h-auto rounded-xl object-cover"
                        loading="lazy"
                      />
                    </motion.div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
