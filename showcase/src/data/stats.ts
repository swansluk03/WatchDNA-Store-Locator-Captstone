export type Stat = {
  value: string;
  suffix?: string;
  label: string;
  sublabel: string;
};

export const stats: Stat[] = [
  { value: '28', suffix: 'k+', label: 'Stores scraped', sublabel: 'across 9 brand locators' },
  { value: '50', suffix: '+', label: 'Brands in pipeline', sublabel: 'configured, queued, or live' },
  { value: '5', label: 'Engineers', sublabel: 'one product owner' },
  { value: '7', suffix: ' mo', label: 'Active development', sublabel: 'Sep 2025 — today' },
  { value: '390', suffix: '+', label: 'Commits on main', sublabel: 'across 4 deployment platforms' },
  { value: '4', label: 'Locales on store cards', sublabel: 'EN · FR · ZH · ES' }
];
