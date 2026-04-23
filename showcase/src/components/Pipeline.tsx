import { motion } from 'framer-motion';
import { pipeline } from '../data/pipeline';
import SectionHeading from './ui/SectionHeading';

export default function Pipeline() {
  return (
    <section
      id="pipeline"
      className="py-32 px-6 border-t border-border/40 bg-gradient-to-b from-bg to-bg-elevated/30"
    >
      <div className="max-w-5xl mx-auto">
        <SectionHeading
          kicker="From brand locator to phone screen"
          title="The data pipeline."
          description="Every pin on the live map has walked this exact road. Ten stages, four languages — Python, TypeScript, SQL, HTML/JS — five owners."
        />

        <ol className="relative space-y-6">
          <motion.div
            className="absolute left-5 top-4 bottom-4 w-px bg-gradient-to-b from-gold/60 via-gold/30 to-gold/0"
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 1.6, ease: 'easeInOut' }}
            style={{ transformOrigin: 'top' }}
          />
          {pipeline.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.li
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5, delay: i * 0.04 }}
                className="relative pl-16"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true, margin: '-80px' }}
                  transition={{ duration: 0.4, delay: 0.1 + i * 0.04, type: 'spring' }}
                  className="absolute left-0 top-0 w-10 h-10 rounded-full border border-gold/50 bg-bg-elevated flex items-center justify-center ring-[6px] ring-bg"
                >
                  <Icon className="w-4 h-4 text-gold" />
                </motion.div>
                <div className="rounded-2xl border border-border bg-bg-elevated/80 p-5 md:p-6 hover:border-gold/50 transition-colors">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="font-mono text-[10px] text-gold/70 tracking-widest">
                      STEP {String(i + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-serif text-2xl">{step.label}</h3>
                    <code className="md:ml-auto text-xs text-fg-muted font-mono">
                      {step.tool}
                    </code>
                  </div>
                  <p className="mt-3 text-fg-muted leading-relaxed">{step.description}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
