import { motion } from 'framer-motion';

type Props = {
  kicker: string;
  title: string;
  description?: string;
};

export default function SectionHeading({ kicker, title, description }: Props) {
  return (
    <div className="max-w-3xl mb-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6 }}
      >
        <span className="text-gold/80 text-xs md:text-sm font-medium tracking-[0.2em] uppercase">
          {kicker}
        </span>
        <h2 className="font-serif text-5xl md:text-6xl mt-3 leading-[1.05]">{title}</h2>
        {description && (
          <p className="mt-6 text-lg text-fg-muted leading-relaxed">{description}</p>
        )}
      </motion.div>
    </div>
  );
}
