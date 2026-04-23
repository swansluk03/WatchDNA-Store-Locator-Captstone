import { Github } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-border/40 bg-bg py-12 px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <div className="font-serif text-2xl">WatchDNA Store Locator</div>
          <div className="text-sm text-fg-muted mt-1">
            Capstone project · Arizona State University · 2025–2026
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm text-fg-muted">
          <a
            href="https://dealer-fetcher.vercel.app"
            target="_blank"
            rel="noreferrer"
            className="hover:text-gold transition-colors"
          >
            Live map ↗
          </a>
          <a
            href="https://admin-console-production.up.railway.app/login"
            target="_blank"
            rel="noreferrer"
            className="hover:text-gold transition-colors"
          >
            Admin panel ↗
          </a>
          <a
            href="https://github.com/swansluk03/WatchDNA-Store-Locator-Captstone"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-gold transition-colors"
          >
            <Github className="w-4 h-4" />
            Repo
          </a>
        </div>
      </div>
    </footer>
  );
}
