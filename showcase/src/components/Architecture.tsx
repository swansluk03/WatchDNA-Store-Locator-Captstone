import { motion } from 'framer-motion';
import { archNodes, archEdges, type ArchNode, type Tier } from '../data/architecture';
import SectionHeading from './ui/SectionHeading';

const tierBorder: Record<Tier, string> = {
  client: 'border-sky-400/50',
  edge: 'border-fuchsia-400/50',
  service: 'border-gold/70',
  data: 'border-emerald-400/50',
  external: 'border-rose-400/50'
};

const tierDot: Record<Tier, string> = {
  client: 'bg-sky-400',
  edge: 'bg-fuchsia-400',
  service: 'bg-gold',
  data: 'bg-emerald-400',
  external: 'bg-rose-400'
};

// viewBox aspect matches the container aspect so arrows + angles render without distortion.
const VB_W = 160;
const VB_H = 110;
// Half-card bounds in viewBox units — lines trim back by this before reaching a node.
// Sized to clear the widest card ("Leaflet + MarkerCluster", "universal_scraper.py", etc.)
// with a small visible gap between the arrow tip and the card border.
const NODE_HW = 20;
const NODE_HH = 8;

type Pt = { x: number; y: number };

function toSvg(n: ArchNode): Pt {
  return { x: (n.x / 100) * VB_W, y: (n.y / 100) * VB_H };
}

function trimmedEndpoints(a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx === 0 && ady === 0) {
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  // If the line is flatter than the card's diagonal, it exits the left/right.
  // If steeper, it exits top/bottom.
  const exitsSides = adx * NODE_HH > ady * NODE_HW;

  let ox: number;
  let oy: number;
  if (exitsSides) {
    ox = Math.sign(dx) * NODE_HW;
    oy = (dy / adx) * NODE_HW;
  } else {
    ox = adx === 0 ? 0 : (dx / ady) * NODE_HH;
    oy = Math.sign(dy) * NODE_HH;
  }

  const x1 = a.x + ox;
  const y1 = a.y + oy;
  const x2 = b.x - ox;
  const y2 = b.y - oy;
  return { x1, y1, x2, y2 };
}

// Position a label at the midpoint of the (untrimmed) line, offset perpendicular
// toward the diagram center so it sits in blank space rather than on top of a card.
const LABEL_OFFSET = 5.5;
const CENTER_X = VB_W / 2;
const CENTER_Y = VB_H / 2;

function labelPosition(a: Pt, b: Pt): Pt {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: midX, y: midY };

  const perp1 = { x: -dy / len, y: dx / len };
  const perp2 = { x: dy / len, y: -dx / len };
  const toCx = CENTER_X - midX;
  const toCy = CENTER_Y - midY;
  const dot1 = perp1.x * toCx + perp1.y * toCy;
  const dot2 = perp2.x * toCx + perp2.y * toCy;
  const perp = dot1 > dot2 ? perp1 : perp2;

  return {
    x: midX + perp.x * LABEL_OFFSET,
    y: midY + perp.y * LABEL_OFFSET
  };
}

function strokeDashForKind(kind: 'http' | 'read-write' | 'upload' | 'scrape'): string | undefined {
  if (kind === 'scrape') return '1.2 1.2';
  if (kind === 'upload') return '2.4 1.2';
  return undefined;
}

export default function Architecture() {
  const byId = Object.fromEntries(archNodes.map((n) => [n.id, n]));

  return (
    <section id="architecture" className="py-32 px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          kicker="How it's wired"
          title="Four tiers, one source of truth."
          description="The map on a visitor's phone, the admin console an operator uses, the API that glues them, and the scrapers that feed it all. Every box on the diagram below has an owner on the team."
        />

        <div className="relative rounded-3xl border border-border bg-bg-elevated/60 p-4 md:p-12 overflow-hidden">
          <div className="absolute inset-0 bg-mesh opacity-40 pointer-events-none" />
          <div className="relative aspect-[16/11] w-full">
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className="absolute inset-0 w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <marker
                  id="arrowhead"
                  viewBox="0 0 12 12"
                  refX="10"
                  refY="6"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 12 6 L 0 12 L 3 6 z" fill="#d4af37" />
                </marker>
              </defs>
              {archEdges.map((edge, i) => {
                const fromNode = byId[edge.from];
                const toNode = byId[edge.to];
                if (!fromNode || !toNode) return null;
                const a = toSvg(fromNode);
                const b = toSvg(toNode);
                const { x1, y1, x2, y2 } = trimmedEndpoints(a, b);
                return (
                  <motion.line
                    key={`${edge.from}-${edge.to}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#d4af37"
                    strokeOpacity={0.7}
                    strokeWidth={0.6}
                    strokeLinecap="round"
                    strokeDasharray={strokeDashForKind(edge.kind)}
                    markerEnd="url(#arrowhead)"
                    initial={{ pathLength: 0, opacity: 0 }}
                    whileInView={{ pathLength: 1, opacity: 1 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{
                      duration: 1.2,
                      delay: 0.3 + i * 0.1,
                      ease: 'easeInOut'
                    }}
                  />
                );
              })}
            </svg>

            {archEdges
              .filter((e) => e.label)
              .map((edge, i) => {
                const fromNode = byId[edge.from];
                const toNode = byId[edge.to];
                if (!fromNode || !toNode) return null;
                const a = toSvg(fromNode);
                const b = toSvg(toNode);
                const { x, y } = labelPosition(a, b);
                const pctX = (x / VB_W) * 100;
                const pctY = (y / VB_H) * 100;
                return (
                  <div
                    key={`${edge.from}-${edge.to}-label`}
                    className="pointer-events-none absolute z-10"
                    style={{
                      left: `${pctX}%`,
                      top: `${pctY}%`,
                      transform: 'translate(-50%, -50%)'
                    }}
                  >
                    <motion.span
                      className="inline-block px-2 py-0.5 rounded-full border border-gold/25 bg-bg-elevated text-[9px] md:text-[10px] font-mono tracking-wide text-gold/80 whitespace-nowrap"
                      initial={{ opacity: 0, y: 4 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-50px' }}
                      transition={{ duration: 0.4, delay: 0.9 + i * 0.08 }}
                    >
                      {edge.label}
                    </motion.span>
                  </div>
                );
              })}

            {archNodes.map((n, i) => (
              <div
                key={n.id}
                className="absolute"
                style={{
                  left: `${n.x}%`,
                  top: `${n.y}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <motion.div
                  className={`${tierBorder[n.tier]} bg-bg-card border rounded-xl px-3 py-2 md:px-5 md:py-3 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)]`}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-50px' }}
                  transition={{ duration: 0.5, delay: 0.05 + i * 0.08 }}
                  whileHover={{ y: -3 }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${tierDot[n.tier]}`} />
                    <span className="text-xs md:text-sm font-semibold tracking-wide whitespace-nowrap text-fg">
                      {n.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] md:text-xs text-fg-muted whitespace-nowrap">
                    {n.sublabel}
                  </div>
                  <div className="mt-0.5 text-[9px] md:text-[10px] text-fg-dim whitespace-nowrap font-mono">
                    {n.host}
                  </div>
                </motion.div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3 text-xs text-fg-muted justify-center">
          <LegendPill color="bg-sky-400" label="Client" />
          <LegendPill color="bg-fuchsia-400" label="Edge" />
          <LegendPill color="bg-gold" label="Service" />
          <LegendPill color="bg-emerald-400" label="Data" />
          <LegendPill color="bg-rose-400" label="External" />
          <span className="w-px h-4 bg-border mx-2 self-center" />
          <DashLegend kind="solid" label="HTTP" />
          <DashLegend kind="dashed" label="Upload" />
          <DashLegend kind="dotted" label="Scrape" />
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-6">
          <LegendCard
            color="bg-sky-400"
            title="Clients"
            body="End users hit the Leaflet map via an iframe on the WatchDNA Shopify storefront. Admins use the React admin panel over JWT-protected routes."
          />
          <LegendCard
            color="bg-gold"
            title="Services"
            body="Railway runs the Express API and admin panel. A Python scraper fleet backfills brand locators on a schedule and uploads the validated CSV."
          />
          <LegendCard
            color="bg-emerald-400"
            title="Data"
            body="Supabase Postgres is the source of truth for Location, Premium, and AnalyticsEvent. Shopify hosts the store images — we keep the GID on the row."
          />
        </div>
      </div>
    </section>
  );
}

function LegendPill({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-bg-elevated/60">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="uppercase tracking-widest">{label}</span>
    </span>
  );
}

function DashLegend({
  kind,
  label
}: {
  kind: 'solid' | 'dashed' | 'dotted';
  label: string;
}) {
  const dashClass =
    kind === 'solid'
      ? 'border-t'
      : kind === 'dashed'
      ? 'border-t border-dashed'
      : 'border-t border-dotted';
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-bg-elevated/60">
      <span className={`block w-6 ${dashClass} border-gold/70`} />
      <span className="uppercase tracking-widest">{label}</span>
    </span>
  );
}

function LegendCard({ color, title, body }: { color: string; title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5 }}
      className="rounded-2xl border border-border bg-bg-elevated p-6"
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-xs uppercase tracking-widest text-fg-muted">{title}</span>
      </div>
      <p className="mt-3 text-fg leading-relaxed">{body}</p>
    </motion.div>
  );
}
