import { motion } from 'framer-motion';
import { stats } from '../data/stats';
import SectionHeading from './ui/SectionHeading';

export default function Overview() {
  return (
    <section id="overview" className="py-32 px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          kicker="Where the project stands"
          title="A global map of watch retailers."
          description="The project began September 29, 2025 with a blank repo and Thomas's brand list. Seven months later it is a production pipeline — scrape, validate, normalize, translate, serve, render — backed by a team of five."
        />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-border/40 border border-border/40 rounded-2xl overflow-hidden">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="bg-bg-elevated p-8 md:p-10 hover:bg-bg-card transition-colors"
            >
              <div className="flex items-baseline gap-1">
                <span className="font-serif text-5xl md:text-6xl text-gradient-gold">
                  {s.value}
                </span>
                {s.suffix && (
                  <span className="font-serif text-3xl md:text-4xl text-gold/70">
                    {s.suffix}
                  </span>
                )}
              </div>
              <div className="mt-4 text-sm font-medium uppercase tracking-widest text-fg">
                {s.label}
              </div>
              <div className="mt-2 text-sm text-fg-muted">{s.sublabel}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
