import { motion } from 'framer-motion';
import { useMemo } from 'react';

type Pin = { x: number; y: number; size: number; delay: number };

export default function AnimatedBackground() {
  const pins = useMemo<Pin[]>(() => {
    const arr: Pin[] = [];
    const seeded = (n: number) => {
      const x = Math.sin(n) * 10000;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 50; i++) {
      arr.push({
        x: seeded(i * 7.3) * 100,
        y: seeded(i * 11.7 + 1) * 100,
        size: 3 + seeded(i * 3.1 + 2) * 7,
        delay: seeded(i * 5.5 + 3) * 3
      });
    }
    return arr;
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-bg-elevated/40" />
      <svg
        className="absolute inset-0 w-full h-full text-fg-muted opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="hero-grid" width="64" height="64" patternUnits="userSpaceOnUse">
            <path d="M 64 0 L 0 0 0 64" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hero-grid)" />
      </svg>
      {pins.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-gold/50 shadow-[0_0_12px_rgba(212,175,55,0.6)]"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 0.9, 0], scale: [0, 1, 0.6] }}
          transition={{ duration: 3.2, delay: p.delay, repeat: Infinity, repeatDelay: 1.2 }}
        />
      ))}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}
