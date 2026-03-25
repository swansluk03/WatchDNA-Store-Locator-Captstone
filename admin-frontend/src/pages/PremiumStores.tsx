import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  fetchAllStores,
  markStoresPremium,
  removeStoresPremium,
  type StoreRecord,
} from '../services/premium.service';
import '../styles/PremiumStores.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAddress(store: StoreRecord): string {
  const parts = [
    store.addressLine1,
    store.addressLine2,
    store.city,
    store.stateProvinceRegion,
    store.postalCode,
    store.country,
  ].filter(Boolean);
  return parts.join(', ');
}

function parseBrands(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StoreCardProps {
  store: StoreRecord;
  selected: boolean;
  onClick: () => void;
}

const StoreCard: React.FC<StoreCardProps> = ({ store, selected, onClick }) => {
  const brands = parseBrands(store.brands);

  return (
    <div
      className={`store-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => e.key === ' ' && onClick()}
    >
      <div className="store-card__check">
        <svg className="store-card__check-icon" viewBox="0 0 12 12" fill="none">
          <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="store-card__top">
        <span className="store-card__name">{store.name}</span>
        {store.isPremium && (
          <span className="badge badge-warning badge-premium">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            Premium
          </span>
        )}
      </div>

      <div className="store-card__address">{formatAddress(store)}</div>

      {store.phone && (
        <div className="store-card__phone">{store.phone}</div>
      )}

      {brands.length > 0 && (
        <div className="store-card__brands">
          {brands.map((b) => (
            <span key={b} className="brand-pill">{b}</span>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const AUTOCOMPLETE_LIMIT = 8;

const PremiumStores: React.FC = () => {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [premiumOnly, setPremiumOnly] = useState(false);

  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLUListElement>(null);

  // Load all stores once on mount
  useEffect(() => {
    fetchAllStores()
      .then(setStores)
      .catch(() => setError('Failed to load stores. Please refresh the page.'))
      .finally(() => setLoading(false));
  }, []);

  // Dismiss toast after 3 s
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(e.target as Node) &&
        autocompleteRef.current &&
        !autocompleteRef.current.contains(e.target as Node)
      ) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Derived filter options ────────────────────────────────────────────────

  const allBrands = useMemo(() => {
    const set = new Set<string>();
    stores.forEach((s) => parseBrands(s.brands).forEach((b) => set.add(b)));
    return Array.from(set).sort();
  }, [stores]);

  const allCountries = useMemo(() => {
    const set = new Set<string>();
    stores.forEach((s) => s.country && set.add(s.country));
    return Array.from(set).sort();
  }, [stores]);

  // ── Filtered stores ───────────────────────────────────────────────────────

  const filteredStores = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return stores.filter((s) => {
      if (premiumOnly && !s.isPremium) return false;
      if (selectedBrand && !parseBrands(s.brands).includes(selectedBrand)) return false;
      if (selectedCountry && s.country !== selectedCountry) return false;
      if (query) {
        const haystack = `${s.name} ${formatAddress(s)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [stores, searchText, selectedBrand, selectedCountry, premiumOnly]);

  // ── Autocomplete suggestions ──────────────────────────────────────────────

  const autocompleteSuggestions = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];
    return stores
      .filter((s) => {
        const nameLower = s.name.toLowerCase();
        const addrLower = formatAddress(s).toLowerCase();
        return nameLower.includes(query) || addrLower.includes(query);
      })
      .slice(0, AUTOCOMPLETE_LIMIT);
  }, [stores, searchText]);

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleHandle = useCallback((handle: string) => {
    setSelectedHandles((prev) => {
      const next = new Set(prev);
      next.has(handle) ? next.delete(handle) : next.add(handle);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedHandles((prev) => {
      const next = new Set(prev);
      filteredStores.forEach((s) => next.add(s.handle));
      return next;
    });
  }, [filteredStores]);

  const clearSelection = useCallback(() => {
    setSelectedHandles(new Set());
  }, []);

  const removeFromSelection = useCallback((handle: string) => {
    setSelectedHandles((prev) => {
      const next = new Set(prev);
      next.delete(handle);
      return next;
    });
  }, []);

  const selectedStores = useMemo(
    () => stores.filter((s) => selectedHandles.has(s.handle)),
    [stores, selectedHandles]
  );

  const nonPremiumSelected = useMemo(
    () => selectedStores.filter((s) => !s.isPremium),
    [selectedStores]
  );

  const premiumSelected = useMemo(
    () => selectedStores.filter((s) => s.isPremium),
    [selectedStores]
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleMarkPremium = async () => {
    const handles = nonPremiumSelected.map((s) => s.handle);
    if (handles.length === 0) return;
    setSubmitting(true);
    try {
      const result = await markStoresPremium(handles);
      setStores((prev) =>
        prev.map((s) => (handles.includes(s.handle) ? { ...s, isPremium: true } : s))
      );
      setSelectedHandles(new Set());
      setToast({ message: `${result.marked} store(s) marked as premium.`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to mark stores as premium. Please try again.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemovePremium = async () => {
    const handles = premiumSelected.map((s) => s.handle);
    if (handles.length === 0) return;
    setSubmitting(true);
    try {
      const result = await removeStoresPremium(handles);
      setStores((prev) =>
        prev.map((s) => (handles.includes(s.handle) ? { ...s, isPremium: false } : s))
      );
      setSelectedHandles(new Set());
      setToast({ message: `Premium status removed from ${result.removed} store(s).`, type: 'success' });
    } catch {
      setToast({ message: 'Failed to remove premium status. Please try again.', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const resetFilters = () => {
    setSearchText('');
    setSelectedBrand('');
    setSelectedCountry('');
    setPremiumOnly(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="loading">Loading stores...</div>;
  if (error) return <div className="error">{error}</div>;

  const allFilteredSelected =
    filteredStores.length > 0 &&
    filteredStores.every((s) => selectedHandles.has(s.handle));

  return (
    <div className="premium-stores">
      {toast && (
        <div className={`premium-toast ${toast.type}`}>{toast.message}</div>
      )}

      <div className="premium-stores__header">
        <h1>Premium Stores</h1>
        <span className="premium-stores__count">
          {stores.filter((s) => s.isPremium).length} premium &middot; {stores.length} total
        </span>
      </div>

      {/* Filter bar */}
      <div className="premium-filters">
        <div className="premium-filter-group">
          <label>Brand</label>
          <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}>
            <option value="">All brands</option>
            {allBrands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div className="premium-filter-group">
          <label>Country</label>
          <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)}>
            <option value="">All countries</option>
            {allCountries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="premium-filter-group premium-filter-search" style={{ position: 'relative' }}>
          <label>Name or Address</label>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search stores..."
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setShowAutocomplete(true);
            }}
            onFocus={() => setShowAutocomplete(true)}
            autoComplete="off"
          />
          {showAutocomplete && autocompleteSuggestions.length > 0 && (
            <ul className="autocomplete-list" ref={autocompleteRef}>
              {autocompleteSuggestions.map((s) => (
                <li
                  key={s.handle}
                  onMouseDown={() => {
                    setSearchText(s.name);
                    setShowAutocomplete(false);
                  }}
                >
                  <div className="autocomplete-name">{s.name}</div>
                  <div className="autocomplete-address">{formatAddress(s)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="premium-toggle">
          <div
            className={`toggle-switch${premiumOnly ? ' on' : ''}`}
            onClick={() => setPremiumOnly((v) => !v)}
            role="switch"
            aria-checked={premiumOnly}
            tabIndex={0}
            onKeyDown={(e) => e.key === ' ' && setPremiumOnly((v) => !v)}
          >
            <div className="toggle-knob" />
          </div>
          <span>Premium only</span>
        </label>

        <button className="premium-filter-reset" onClick={resetFilters}>
          Clear filters
        </button>
      </div>

      {/* Toolbar */}
      <div className="premium-toolbar">
        <span className="premium-toolbar__info">
          Showing {filteredStores.length} store{filteredStores.length !== 1 ? 's' : ''}
          {selectedHandles.size > 0 && ` · ${selectedHandles.size} selected`}
        </span>
        <div className="premium-toolbar__actions">
          {filteredStores.length > 0 && (
            <button className="btn-select-all" onClick={allFilteredSelected ? clearSelection : selectAllFiltered}>
              {allFilteredSelected ? 'Deselect all' : `Select all ${filteredStores.length}`}
            </button>
          )}
        </div>
      </div>

      {/* Store grid */}
      <div className="premium-grid">
        {filteredStores.length === 0 ? (
          <div className="premium-empty">No stores match your filters.</div>
        ) : (
          filteredStores.map((store) => (
            <StoreCard
              key={store.handle}
              store={store}
              selected={selectedHandles.has(store.handle)}
              onClick={() => toggleHandle(store.handle)}
            />
          ))
        )}
      </div>

      {/* Spacer so review panel doesn't cover last row */}
      {selectedHandles.size > 0 && <div className="review-panel-spacer" />}

      {/* Review panel */}
      <div className={`review-panel${selectedHandles.size > 0 ? ' visible' : ''}`}>
        <div className="review-panel__inner">
          <div>
            <div className="review-panel__title">{selectedHandles.size} store{selectedHandles.size !== 1 ? 's' : ''} selected</div>
            <button className="btn-clear-selection" onClick={clearSelection}>
              Clear selection
            </button>
          </div>

          <div className="review-panel__list">
            {selectedStores.map((s) => (
              <span key={s.handle} className="review-chip">
                {s.isPremium && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#f59e0b">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                )}
                <span title={s.name}>{s.name}</span>
                <button
                  className="review-chip__remove"
                  onClick={(e) => { e.stopPropagation(); removeFromSelection(s.handle); }}
                  title="Remove from selection"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="review-panel__actions">
            {nonPremiumSelected.length > 0 && (
              <button
                className="btn-mark-premium"
                onClick={handleMarkPremium}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : `Mark ${nonPremiumSelected.length} as Premium`}
              </button>
            )}
            {premiumSelected.length > 0 && (
              <button
                className="btn-remove-premium"
                onClick={handleRemovePremium}
                disabled={submitting}
              >
                {submitting ? 'Saving...' : `Remove Premium (${premiumSelected.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PremiumStores;
