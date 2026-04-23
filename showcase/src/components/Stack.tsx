import { motion } from 'framer-motion';
import { stack, type StackTier } from '../data/stack';
import SectionHeading from './ui/SectionHeading';

const tierOrder: StackTier[] = ['frontend', 'backend', 'data', 'devops'];

const tierLabels: Record<StackTier, string> = {
  frontend: 'Frontend',
  backend: 'Backend & Scrapers',
  data: 'Data',
  devops: 'Deployment'
};

export default function Stack() {
  return (
    <section id="stack" className="py-32 px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          kicker="What we built it with"
          title="Technology stack."
          description="Opinionated enough to move fast, boring enough to run in production."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {tierOrder.map((tier, i) => {
            const items = stack.filter((s) => s.tier === tier);
            return (
              <motion.div
                key={tier}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-2xl border border-border bg-bg-elevated/60 p-6"
              >
                <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80 mb-4">
                  {tierLabels[tier]}
                </div>
                <ul className="space-y-3">
                  {items.map((s) => (
                    <li key={s.name} className="group">
                      <div className="font-medium text-fg group-hover:text-gold transition-colors">
                        {s.name}
                      </div>
                      <div className="text-sm text-fg-muted">{s.role}</div>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
