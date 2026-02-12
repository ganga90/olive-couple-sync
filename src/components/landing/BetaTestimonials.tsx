import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Star } from "lucide-react";

export const BetaTestimonials = () => {
  const { t } = useTranslation('landing');

  const testimonials = [
    {
      quote: t('testimonials.items.0.quote'),
      author: t('testimonials.items.0.author'),
      role: t('testimonials.items.0.role'),
      avatar: '👩‍💼',
    },
    {
      quote: t('testimonials.items.1.quote'),
      author: t('testimonials.items.1.author'),
      role: t('testimonials.items.1.role'),
      avatar: '❤️',
    },
    {
      quote: t('testimonials.items.2.quote'),
      author: t('testimonials.items.2.author'),
      role: t('testimonials.items.2.role'),
      avatar: '💼',
    },
  ];

  return (
    <section className="py-20 px-4 bg-[#EAE8E0]">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 bg-olive/10 text-olive px-4 py-2 rounded-full text-sm font-medium mb-4">
            💬 {t('testimonials.eyebrow')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-stone-900 mb-4">
            {t('testimonials.headline')}
          </h2>
        </motion.div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-lg"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                ))}
              </div>

              {/* Quote */}
              <p className="text-stone-700 leading-relaxed mb-6">
                "{testimonial.quote}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-xl">
                  {testimonial.avatar}
                </div>
                <div>
                  <p className="font-semibold text-stone-900">{testimonial.author}</p>
                  <p className="text-sm text-stone-500">{testimonial.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
