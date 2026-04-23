import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { team, type TeamMember } from '../data/team';
import SectionHeading from './ui/SectionHeading';
import { ChevronDown, Sparkles } from 'lucide-react';

export default function Team() {
  const [openId, setOpenId] = useState<string | null>(team[0]?.id ?? null);

  return (
    <section id="team" className="py-32 px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          kicker="The people behind the map"
          title="Five engineers, one pipeline."
          description="Tap any panel to expand. Each team member can walk through their work live from the contributions grid and the talking-points list inside."
        />

        <div className="grid gap-3">
          {team.map((member, i) => (
            <MemberRow
              key={member.id}
              member={member}
              index={i}
              isOpen={openId === member.id}
              onToggle={() => setOpenId(openId === member.id ? null : member.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberRow({
  member,
  index,
  isOpen,
  onToggle
}: {
  member: TeamMember;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
      className={`rounded-2xl border overflow-hidden transition-all ${
        isOpen
          ? 'border-gold/50 bg-bg-card'
          : 'border-border bg-bg-elevated/50 hover:border-border-light'
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-6 md:p-8 flex items-center gap-6 group"
      >
        <Avatar name={member.name} accent={member.accent} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-serif text-2xl md:text-3xl truncate">{member.name}</h3>
            <span className="font-mono text-xs text-fg-dim">@{member.handle}</span>
          </div>
          <div className="mt-1 text-xs md:text-sm uppercase tracking-[0.2em] text-gold/80">
            {member.role}
          </div>
          <p className="mt-2 text-fg-muted text-sm md:text-base max-w-2xl">
            {member.focus}
          </p>
        </div>
        <div className="hidden md:flex flex-col items-end gap-1 text-right">
          <div className="font-mono text-sm text-fg">
            <span className="text-gold">{member.commits}</span> commits
          </div>
          <div className="font-mono text-[10px] text-fg-dim">
            +{member.linesAdded.toLocaleString()} / -{member.linesRemoved.toLocaleString()}
          </div>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3 }}
          className="text-fg-muted group-hover:text-gold transition-colors"
        >
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-6 md:px-8 pb-8 grid md:grid-cols-5 gap-8">
              <div className="md:col-span-2 space-y-6">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-fg-dim mb-3">
                    The elevator pitch
                  </div>
                  <p className="text-fg leading-relaxed">{member.pitch}</p>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.2em] text-fg-dim mb-3">
                    Primary ownership
                  </div>
                  <ul className="space-y-1.5">
                    {member.ownership.map((o) => (
                      <li
                        key={o}
                        className="font-mono text-xs text-fg-muted flex items-start gap-2"
                      >
                        <span className="text-gold mt-0.5">▸</span>
                        <span className="break-all">{o}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-gold/20 bg-gold/5 p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gold mb-3">
                    <Sparkles className="w-3.5 h-3.5" />
                    Live-demo talking points
                  </div>
                  <ul className="space-y-2">
                    {member.talkingPoints.map((t) => (
                      <li key={t} className="text-sm text-fg-muted flex gap-2">
                        <span className="text-gold/60">·</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="md:col-span-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-fg-dim mb-4">
                  Key contributions
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {member.contributions.map((c, j) => (
                    <motion.div
                      key={c.area}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.1 + j * 0.05 }}
                      className="rounded-xl border border-border bg-bg-elevated/60 p-4 hover:border-gold/40 hover:bg-bg-card transition-colors"
                    >
                      <div className="font-medium text-fg">{c.area}</div>
                      <div className="mt-2 text-sm text-fg-muted leading-relaxed">
                        {c.details}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Avatar({ name, accent }: { name: string; accent: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('');
  return (
    <div
      className={`flex-shrink-0 w-14 h-14 rounded-full bg-gradient-to-br ${accent} border border-border flex items-center justify-center`}
    >
      <span className="font-serif text-xl text-fg">{initials}</span>
    </div>
  );
}
