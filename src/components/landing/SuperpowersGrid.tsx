import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Receipt, Brain, Bell, ArrowRight } from "lucide-react";

export const SuperpowersGrid = () => {
  const { t } = useTranslation('landing');

  const superpowers = [
    {
      id: 'receipt',
      icon: Receipt,
      title: t('superpowers.receipt.title'),
      description: t('superpowers.receipt.description'),
      visual: 'receipt',
      gradient: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-50',
    },
    {
      id: 'memory',
      icon: Brain,
      title: t('superpowers.memory.title'),
      description: t('superpowers.memory.description'),
      visual: 'memory',
      gradient: 'from-violet-500 to-purple-500',
      bgColor: 'bg-violet-50',
    },
    {
      id: 'wishlist',
      icon: Bell,
      title: t('superpowers.wishlist.title'),
      description: t('superpowers.wishlist.description'),
      visual: 'wishlist',
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
                    {power.visual === 'receipt' && <ReceiptVisual />}
                    {power.visual === 'memory' && <MemoryVisual />}
                    {power.visual === 'wishlist' && <WishlistVisual />}
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
const ReceiptVisual = () => (
  <div className="relative w-full">
    <motion.div
      initial={{ opacity: 0.5, rotate: -5 }}
      whileInView={{ opacity: 1, rotate: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-white rounded-lg p-3 shadow-md transform -rotate-3 absolute left-4 top-0"
    >
      <div className="w-32 h-40 bg-gradient-to-b from-stone-100 to-stone-200 rounded flex flex-col items-center justify-center">
        <div className="w-20 h-2 bg-stone-300 rounded mb-2" />
        <div className="w-16 h-2 bg-stone-300 rounded mb-2" />
        <div className="w-24 h-2 bg-stone-300 rounded mb-2" />
        <div className="text-xs text-stone-400 mt-2">$127.50</div>
      </div>
    </motion.div>
    
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.5 }}
      className="bg-white rounded-xl p-3 shadow-lg absolute right-2 bottom-2"
    >
      <div className="flex items-center gap-2 text-xs">
        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
          🧾
        </div>
        <div>
          <p className="font-semibold text-stone-800">Groceries</p>
          <p className="text-stone-500">$127.50</p>
        </div>
        <div className="bg-red-100 text-red-600 text-[10px] px-2 py-0.5 rounded-full font-medium">
          ⚠️ Over Budget
        </div>
      </div>
    </motion.div>
    
    <ArrowRight className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-amber-400" />
  </div>
);

const MemoryVisual = () => (
  <div className="space-y-3 w-full px-2">
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      className="bg-violet-100 rounded-2xl rounded-br-sm px-3 py-2 ml-auto max-w-[80%]"
    >
      <p className="text-xs text-violet-800">What hotel did we like in Bologna?</p>
    </motion.div>
    
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-2xl rounded-bl-sm px-3 py-2 mr-auto max-w-[90%] shadow-sm"
    >
      <p className="text-xs text-stone-700">
        <span className="font-semibold">Hotel Porta San Mamolo</span>
        <br />
        <span className="text-stone-500">You loved the breakfast but hated the pillows 🛏️</span>
      </p>
    </motion.div>
  </div>
);

const WishlistVisual = () => (
  <motion.div
    initial={{ y: 20, opacity: 0 }}
    whileInView={{ y: 0, opacity: 1 }}
    className="bg-white rounded-2xl p-4 shadow-lg max-w-[200px]"
  >
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-lg">
        🎁
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-stone-800">Price Drop Alert!</p>
        <p className="text-[10px] text-stone-500 mt-0.5">
          "Sony Headphones" your partner saved is now 30% off
        </p>
        <motion.div
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          transition={{ delay: 0.5, type: "spring" }}
          className="mt-2 bg-emerald-500 text-white text-[10px] px-2 py-1 rounded-full inline-block font-medium"
        >
          🔔 Buy Now - $199
        </motion.div>
      </div>
    </div>
  </motion.div>
);
