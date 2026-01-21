import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Quote } from "lucide-react";
import { motion } from "framer-motion";

const testimonials = [
  {
    quoteKey: "socialProof.testimonials.0.quote",
    authorKey: "socialProof.testimonials.0.author",
    avatarGradient: "from-rose-300 to-pink-400",
  },
  {
    quoteKey: "socialProof.testimonials.1.quote",
    authorKey: "socialProof.testimonials.1.author",
    avatarGradient: "from-amber-300 to-orange-400",
  },
  {
    quoteKey: "socialProof.testimonials.2.quote",
    authorKey: "socialProof.testimonials.2.author",
    avatarGradient: "from-emerald-300 to-teal-400",
  },
  {
    quoteKey: "socialProof.testimonials.3.quote",
    authorKey: "socialProof.testimonials.3.author",
    avatarGradient: "from-blue-300 to-indigo-400",
  },
  {
    quoteKey: "socialProof.testimonials.4.quote",
    authorKey: "socialProof.testimonials.4.author",
    avatarGradient: "from-violet-300 to-purple-400",
  },
  {
    quoteKey: "socialProof.testimonials.5.quote",
    authorKey: "socialProof.testimonials.5.author",
    avatarGradient: "from-cyan-300 to-sky-400",
  },
];

export const SocialProof = () => {
  const { t } = useTranslation('landing');

  return (
    <section className="bg-white py-20 md:py-28 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-serif text-stone-900 mb-4">
            {t('socialProof.headline')}
          </h2>
          <p className="text-xl text-stone-600">
            {t('socialProof.subheadline')}
          </p>
        </motion.div>

        {/* Masonry-style grid */}
        <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="break-inside-avoid"
            >
              <Card className="border-stone-200 shadow-sm hover:shadow-md transition-all duration-300">
                <CardContent className="p-6 space-y-4">
                  <Quote className="h-6 w-6 text-primary/40" />
                  <p className="text-stone-700 leading-relaxed italic">
                    "{t(testimonial.quoteKey)}"
                  </p>
                  <div className="flex items-center gap-3 pt-2">
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${testimonial.avatarGradient}`} />
                    <span className="text-sm font-medium text-stone-600">
                      {t(testimonial.authorKey)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
