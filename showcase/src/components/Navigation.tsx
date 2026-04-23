import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'team', label: 'Team' },
  { id: 'stack', label: 'Stack' }
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled ? 'glass border-b border-border/50' : 'bg-transparent'
      }`}
    >
      <nav className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2 text-fg hover:text-gold transition-colors">
          <span className="font-serif text-2xl tracking-tight">WatchDNA</span>
          <span className="text-fg-dim text-sm hidden sm:inline">/ Showcase</span>
        </a>
        <ul className="hidden md:flex items-center gap-8">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-sm text-fg-muted hover:text-gold transition-colors"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href="https://github.com/swansluk03/WatchDNA-Store-Locator-Captstone"
          target="_blank"
          rel="noreferrer"
          className="text-sm px-4 py-2 border border-border rounded-full text-fg-muted hover:text-gold hover:border-gold transition-colors"
        >
          View Repo →
        </a>
      </nav>
    </motion.header>
  );
}
