/**
 * Country name normalization for the backend.
 *
 * Mirrors the logic in Prototypes/Data_Scrappers/country_normalize.py so that
 * country values are handled consistently whether they enter via a fresh CSV
 * import or via an API query parameter.
 *
 * Resolution order:
 *   1. Aliases (e.g. "USA", "UK", "UAE") → canonical full name
 *   2. 2-letter ISO alpha-2 code → watch_store_countries.json first, then i18n-iso-countries
 *   3. Full-name string → case-insensitive match against JSON values
 *   4. Unrecognised → returned trimmed as-is
 */

import * as isoCountries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

import watchCountriesData from '../data/watch_store_countries.json';

isoCountries.registerLocale(enLocale);

// Code → preferred full name (project-level overrides)
const JSON_CODES: Record<string, string> = watchCountriesData.countries as Record<string, string>;
// Lowercase full name → canonical casing
const JSON_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(JSON_CODES).map((name) => [name.toLowerCase(), name])
);

const ALIASES: Record<string, string> = {
  // United States
  'usa': 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'united states of america': 'United States',
  // United Kingdom
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',
  'scotland': 'United Kingdom',
  'wales': 'United Kingdom',
  'northern ireland': 'United Kingdom',
  // United Arab Emirates
  'uae': 'United Arab Emirates',
  'u.a.e.': 'United Arab Emirates',
  // South Korea
  'korea': 'South Korea',
  'republic of korea': 'South Korea',
  // Czech Republic
  'czechia': 'Czech Republic',
  // Hong Kong
  'hk': 'Hong Kong',
  // Macau
  'macao': 'Macau',
  // Taiwan
  'taiwan, province of china': 'Taiwan',
  'chinese taipei': 'Taiwan',
  // Russia
  'russian federation': 'Russia',
  // Iran
  'iran, islamic republic of': 'Iran',
  // Syria
  'syrian arab republic': 'Syria',
  // Vietnam
  'viet nam': 'Vietnam',
  // South Africa
  'rsa': 'South Africa',
  // United States of America (returned by i18n-iso-countries for US)
  'brasil': 'Brazil',
};

/**
 * Return the canonical English country name for a raw country value.
 * Empty / whitespace input returns an empty string.
 */
export function normalizeCountry(value: string): string {
  if (!value) return '';
  const stripped = value.trim();
  if (!stripped) return '';

  const lower = stripped.toLowerCase();

  // 1. Alias check
  const alias = ALIASES[lower];
  if (alias) return alias;

  // 2. ISO alpha-2 code (exactly 2 letters)
  if (/^[A-Za-z]{2}$/.test(stripped)) {
    const code = stripped.toUpperCase();

    // JSON first
    const jsonResult = JSON_CODES[code];
    if (jsonResult) return jsonResult;

    // i18n-iso-countries fallback
    const isoName = isoCountries.getName(code, 'en');
    if (isoName) {
      // Check if i18n name itself needs alias resolution
      const isoAlias = ALIASES[isoName.toLowerCase()];
      return isoAlias ?? isoName;
    }

    // Unknown alpha-2 — return as-is
    return stripped;
  }

  // 3. Full-name → canonical casing from JSON
  const jsonCanon = JSON_NAMES[lower];
  if (jsonCanon) return jsonCanon;

  // 4. No match — return trimmed original
  return stripped;
}
