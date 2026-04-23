import { motion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import AnimatedBackground from './ui/AnimatedBackground';

export default function Hero() {
  return (
    <section id="top" className="relative min-h-screen flex items-center overflow-hidden bg-mesh">
      <AnimatedBackground />
      <div className="relative z-10 max-w-7xl mx-auto px-6 py-32 w-full">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="max-w-4xl"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="flex items-center gap-2 text-gold/80 text-sm font-medium tracking-[0.2em] uppercase mb-6"
          >
            <MapPin className="w-4 h-4" />
            <span>Capstone · Fall 2025 — Spring 2026</span>
          </motion.div>
          <h1 className="font-serif text-6xl sm:text-7xl md:text-8xl lg:text-9xl leading-[0.95] tracking-tight">
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="block"
            >
              The <em className="text-gradient-gold not-italic font-medium">WatchDNA</em>
            </motion.span>
            <motion.span
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="block italic text-fg"
            >
              Store Locator
            </motion.span>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="mt-8 text-xl md:text-2xl text-fg-muted max-w-3xl leading-relaxed"
          >
            A global directory of 28,000+ authorized watch retailers.
            Five engineers, seven months, one unified pipeline from brand locator
            to phone screen.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.8 }}
            className="mt-12 flex flex-wrap gap-4"
          >
            <a
              href="#overview"
              className="px-6 py-3 rounded-full bg-gold text-bg font-medium hover:bg-gold-light transition-colors"
            >
              Explore the project
            </a>
            <a
              href="#team"
              className="px-6 py-3 rounded-full border border-border text-fg hover:border-gold hover:text-gold transition-colors"
            >
              Meet the team
            </a>
          </motion.div>
        </motion.div>
      </div>
      <motion.div
        animate={{ opacity: [0.3, 1, 0.3], y: [0, 6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-fg-dim text-xs tracking-[0.3em] uppercase"
      >
        Scroll
      </motion.div>
    </section>
  );
}
