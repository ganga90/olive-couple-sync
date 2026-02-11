import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { MessageCircle, FolderOpen, Zap, ArrowRight } from "lucide-react";
import { Bell, Check } from "lucide-react";

export const SuperpowersGrid = () => {
  const { t } = useTranslation('landing');

  const superpowers = [
    {
      id: 'capture',
      icon: MessageCircle,
      title: t('superpowers.capture.title'),
      description: t('superpowers.capture.description'),
      visual: 'capture',
      gradient: 'from-violet-500 to-purple-500',
      bgColor: 'bg-violet-50',
    },
    {
      id: 'organize',
      icon: FolderOpen,
      title: t('superpowers.organize.title'),
      description: t('superpowers.organize.description'),
      visual: 'organize',
      gradient: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-50',
    },
    {
      id: 'act',
      icon: Zap,
      title: t('superpowers.act.title'),
      description: t('superpowers.act.description'),
      visual: 'act',
      gradient: 'from-emerald-500 to-teal-500',
      bgColor: 'bg-emerald-50',
    },
  ];

  return (
    <section className="py-20 px-4 bg-[#EAE8E0]" id="superpowers">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 bg-olive/10 text-olive px-4 py-2 rounded-full text-sm font-medium mb-4">
            ✨ {t('superpowers.eyebrow')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mb-4">
            {t('superpowers.headline')}
          </h2>
          <p className="text-lg text-stone-600 max-w-2xl mx-auto">
            {t('superpowers.subheadline')}
          </p>
        </motion.div>

        {/* Superpowers Grid */}
        <div className="grid md:grid-cols-3 gap-8">
          {superpowers.map((power, index) => {
            const Icon = power.icon;

            return (
              <motion.div
                key={power.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="group"
              >
                <div className="bg-white rounded-3xl p-6 h-full shadow-lg shadow-stone-900/5 hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                  {/* Visual Preview */}
                  <div className={`${power.bgColor} rounded-2xl p-4 mb-6 h-48 flex items-center justify-center overflow-hidden`}>
                    {power.visual === 'capture' && <CaptureVisual />}
                    {power.visual === 'organize' && <OrganizeVisual />}
                    {power.visual === 'act' && <ActVisual />}
                  </div>

                  {/* Icon */}
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-r ${power.gradient} flex items-center justify-center mb-4 shadow-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>

                  {/* Content */}
                  <h3 className="text-xl font-bold text-stone-900 mb-3">
                    {power.title}
                  </h3>
                  <p className="text-stone-600 leading-relaxed">
                    {power.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// Visual Components
const CaptureVisual = () => (
  <div className="relative w-full h-full flex items-center justify-center">
    {/* Scattered message bubbles */}
    <motion.div
      initial={{ opacity: 0, y: -10, rotate: -6 }}
      whileInView={{ opacity: 1, y: 0, rotate: -6 }}
      transition={{ duration: 0.4 }}
      className="absolute left-2 top-3"
    >
      <div className="bg-white rounded-xl rounded-bl-sm px-3 py-2 shadow-md transform">
        <p className="text-[10px] text-stone-600 font-medium">Gate code: 4821#</p>
      </div>
    </motion.div>

    <motion.div
      initial={{ opacity: 0, y: -10, rotate: 4 }}
      whileInView={{ opacity: 1, y: 0, rotate: 4 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="absolute right-1 top-2"
    >
      <div className="bg-white rounded-xl rounded-br-sm px-3 py-2 shadow-md">
        <p className="text-[10px] text-violet-600 font-medium">bit.ly/recipe-link</p>
      </div>
    </motion.div>

    <motion.div
      initial={{ opacity: 0, y: -10, rotate: -3 }}
      whileInView={{ opacity: 1, y: 0, rotate: -3 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="absolute left-6 top-[52px]"
    >
      <div className="bg-white rounded-xl rounded-bl-sm px-3 py-2 shadow-md">
        <p className="text-[10px] text-stone-600 font-medium">Milk, eggs, bread</p>
      </div>
    </motion.div>

    {/* Funnel arrow pointing down */}
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      whileInView={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5, duration: 0.3 }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center"
    >
      <div className="w-8 h-8 rounded-full bg-violet-200 flex items-center justify-center">
        <ArrowRight className="w-4 h-4 text-violet-600 rotate-90" />
      </div>
    </motion.div>
  </div>
);

const OrganizeVisual = () => (
  <div className="flex flex-col gap-3 w-full px-4">
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-white rounded-xl px-4 py-2.5 shadow-md flex items-center gap-3"
    >
      <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center text-sm">
        🥬
      </div>
      <p className="text-xs font-semibold text-stone-700">Groceries</p>
    </motion.div>

    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="bg-white rounded-xl px-4 py-2.5 shadow-md flex items-center gap-3"
    >
      <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center text-sm">
        📅
      </div>
      <p className="text-xs font-semibold text-stone-700">Calendar</p>
    </motion.div>

    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="bg-white rounded-xl px-4 py-2.5 shadow-md flex items-center gap-3"
    >
      <div className="w-7 h-7 rounded-lg bg-yellow-100 flex items-center justify-center text-sm">
        💡
      </div>
      <p className="text-xs font-semibold text-stone-700">Ideas</p>
    </motion.div>
  </div>
);

const ActVisual = () => (
  <motion.div
    initial={{ y: 20, opacity: 0 }}
    whileInView={{ y: 0, opacity: 1 }}
    className="bg-white rounded-2xl p-4 shadow-lg max-w-[220px]"
  >
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
        <Bell className="w-5 h-5 text-emerald-600" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-stone-800">Reminder sent to partner</p>
        <p className="text-[10px] text-stone-500 mt-0.5">
          Pick up groceries on the way home
        </p>
        <motion.div
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          transition={{ delay: 0.5, type: "spring" }}
          className="mt-2 flex items-center gap-1"
        >
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
          <span className="text-[10px] font-medium text-emerald-600">Sent</span>
        </motion.div>
      </div>
    </div>
  </motion.div>
);
