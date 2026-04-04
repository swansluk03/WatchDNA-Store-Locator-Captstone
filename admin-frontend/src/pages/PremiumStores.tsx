import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  fetchAllStores,
  markStoresPremium,
  removeStoresPremium,
  updateStore,
  type StoreRecord,
  type StoreUpdatePayload,
} from '../services/premium.service';
import '../styles/PremiumStores.css';
import { parseBrandsForDisplay, storeMatchesBrandFilter } from '../utils/brandDisplay';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** One street line: line 1 if present, otherwise line 2 (never both). */
function primaryAddressLine(store: StoreRecord): string {
  const a1 = (store.addressLine1 ?? '').trim();
  if (a1) return a1;
  return (store.addressLine2 ?? '').trim();
}

function formatAddress(store: StoreRecord): string {
  const street = primaryAddressLine(store);
  const city = (store.city ?? '').trim();
  const stateRaw = (store.stateProvinceRegion ?? '').trim();
  // Same text in city + state (e.g. "Dubai" as emirate and city) — show once.
  const state =
    stateRaw && (!city || stateRaw.toLowerCase() !== city.toLowerCase())
      ? stateRaw
      : undefined;
  const parts = [
    street || undefined,
    city || undefined,
    state,
    store.postalCode,
    store.country,
  ].filter(Boolean);
  return parts.join(', ');
}

function n2s(v: string | null | undefined): string {
  return v ?? '';
}

function draftToPayload(d: StoreEditDraft, baseline: StoreRecord): StoreUpdatePayload {
  const empty = (s: string) => (s.trim() === '' ? null : s.trim());
  const out: StoreUpdatePayload = {
    addressLine1: d.addressLine1.trim(),
    addressLine2: empty(d.addressLine2),
    city: d.city.trim(),
    stateProvinceRegion: empty(d.stateProvinceRegion),
    postalCode: empty(d.postalCode),
    country: d.country.trim(),
    phone: empty(d.phone),
    website: empty(d.website),
    imageUrl: empty(d.imageUrl),
    pageDescription: empty(d.pageDescription),
    monday: empty(d.monday),
    tuesday: empty(d.tuesday),
    wednesday: empty(d.wednesday),
    thursday: empty(d.thursday),
    friday: empty(d.friday),
    saturday: empty(d.saturday),
    sunday: empty(d.sunday),
  };
  if (d.isPremium !== baseline.isPremium) {
    out.isPremium = d.isPremium;
  }
  return out;
}

function storeToDraft(s: StoreRecord): StoreEditDraft {
  return {
    addressLine1: s.addressLine1,
    addressLine2: n2s(s.addressLine2),
    city: s.city,
    stateProvinceRegion: n2s(s.stateProvinceRegion),
    postalCode: n2s(s.postalCode),
    country: s.country,
    phone: n2s(s.phone),
    website: n2s(s.website),
    imageUrl: n2s(s.imageUrl),
    pageDescription: n2s(s.pageDescription),
    monday: n2s(s.monday),
    tuesday: n2s(s.tuesday),
    wednesday: n2s(s.wednesday),
    thursday: n2s(s.thursday),
    friday: n2s(s.friday),
    saturday: n2s(s.saturday),
    sunday: n2s(s.sunday),
    isPremium: s.isPremium,
  };
}

interface StoreEditDraft {
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvinceRegion: string;
  postalCode: string;
  country: string;
  phone: string;
  website: string;
  imageUrl: string;
  pageDescription: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  isPremium: boolean;
}

const DAY_LABELS: { key: keyof Pick<StoreEditDraft, 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

interface StoreCardProps {
  store: StoreRecord;
  selected: boolean;
  onClick: () => void;
  onEdit: () => void;
}

const StoreCard: React.FC<StoreCardProps> = ({
  store,
  selected,
  onClick,
  onEdit,
}) => {
  const brands = parseBrandsForDisplay(store.brands);

  return (
    <div
      className={`store-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => e.key === ' ' && onClick()}
    >
      <button
        type="button"
        className="store-card__edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        Edit
      </button>
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

  const [editingStore, setEditingStore] = useState<StoreRecord | null>(null);
  const [editDraft, setEditDraft] = useState<StoreEditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [imagePreviewBroken, setImagePreviewBroken] = useState(false);

  useEffect(() => {
    if (!editingStore) {
      setEditDraft(null);
      setImagePreviewBroken(false);
      return;
    }
    setEditDraft(storeToDraft(editingStore));
    setImagePreviewBroken(false);
  }, [editingStore]);

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
    stores.forEach((s) => parseBrandsForDisplay(s.brands).forEach((b) => set.add(b)));
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
      if (selectedBrand && !storeMatchesBrandFilter(s.brands, selectedBrand)) return false;
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

  const closeEditModal = useCallback(() => {
    if (!editSaving) setEditingStore(null);
  }, [editSaving]);

  const updateDraft = useCallback((patch: Partial<StoreEditDraft>) => {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : null));
  }, []);

  const handleSaveEdit = async () => {
    if (!editingStore || !editDraft) return;
    if (!editDraft.addressLine1.trim() || !editDraft.city.trim() || !editDraft.country.trim()) {
      setToast({ message: 'Address line 1, city, and country are required.', type: 'error' });
      return;
    }
    setEditSaving(true);
    try {
      const store = await updateStore(editingStore.handle, draftToPayload(editDraft, editingStore));
      setStores((prev) => prev.map((s) => (s.handle === store.handle ? store : s)));
      setEditingStore(null);
      setToast({ message: 'Store updated.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save store. Please try again.', type: 'error' });
    } finally {
      setEditSaving(false);
    }
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
              onEdit={() => setEditingStore(store)}
            />
          ))
        )}
      </div>

      {/* Spacer so review panel doesn't cover last row */}
      {selectedHandles.size > 0 && <div className="review-panel-spacer" />}

      {/* Review panel */}
      {editingStore && editDraft && (
        <div className="store-edit-overlay" onClick={closeEditModal} role="presentation">
          <div
            className="store-edit-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-edit-title"
          >
            <div className="store-edit-modal__header">
              <h2 id="store-edit-title">Edit store</h2>
              <button
                type="button"
                className="store-edit-modal__close"
                onClick={closeEditModal}
                disabled={editSaving}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="store-edit-modal__body">
              <p className="store-edit-modal__subtitle">{editingStore.name}</p>

              <section className="store-edit-section">
                <h3 className="store-edit-section__title">Address</h3>
                <div className="store-edit-grid">
                  <label className="store-edit-field store-edit-field--full">
                    <span className="store-edit-label">Address line 1</span>
                    <input
                      value={editDraft.addressLine1}
                      onChange={(e) => updateDraft({ addressLine1: e.target.value })}
                    />
                  </label>
                  <label className="store-edit-field store-edit-field--full">
                    <span className="store-edit-label">Address line 2</span>
                    <input
                      value={editDraft.addressLine2}
                      onChange={(e) => updateDraft({ addressLine2: e.target.value })}
                    />
                  </label>
                  <label className="store-edit-field">
                    <span className="store-edit-label">City</span>
                    <input value={editDraft.city} onChange={(e) => updateDraft({ city: e.target.value })} />
                  </label>
                  <label className="store-edit-field">
                    <span className="store-edit-label">State / province</span>
                    <input
                      value={editDraft.stateProvinceRegion}
                      onChange={(e) => updateDraft({ stateProvinceRegion: e.target.value })}
                    />
                  </label>
                  <label className="store-edit-field">
                    <span className="store-edit-label">Postal code</span>
                    <input
                      value={editDraft.postalCode}
                      onChange={(e) => updateDraft({ postalCode: e.target.value })}
                    />
                  </label>
                  <label className="store-edit-field">
                    <span className="store-edit-label">Country</span>
                    <input
                      value={editDraft.country}
                      onChange={(e) => updateDraft({ country: e.target.value })}
                    />
                  </label>
                </div>
              </section>

              <section className="store-edit-section">
                <h3 className="store-edit-section__title">Contact</h3>
                <div className="store-edit-grid">
                  <label className="store-edit-field">
                    <span className="store-edit-label">Phone</span>
                    <input value={editDraft.phone} onChange={(e) => updateDraft({ phone: e.target.value })} />
                  </label>
                  <label className="store-edit-field">
                    <span className="store-edit-label">Website</span>
                    <input
                      type="url"
                      placeholder="https://"
                      value={editDraft.website}
                      onChange={(e) => updateDraft({ website: e.target.value })}
                    />
                  </label>
                </div>
              </section>

              <section className="store-edit-section">
                <h3 className="store-edit-section__title">Image</h3>
                <label className="store-edit-field store-edit-field--full">
                  <span className="store-edit-label">Image URL</span>
                  <input
                    type="url"
                    placeholder="https://"
                    value={editDraft.imageUrl}
                    onChange={(e) => {
                      setImagePreviewBroken(false);
                      updateDraft({ imageUrl: e.target.value });
                    }}
                  />
                </label>
                {editDraft.imageUrl.trim() !== '' && !imagePreviewBroken && (
                  <div className="store-edit-image-preview">
                    <img
                      src={editDraft.imageUrl.trim()}
                      alt=""
                      onError={() => setImagePreviewBroken(true)}
                    />
                  </div>
                )}
              </section>

              <section className="store-edit-section">
                <h3 className="store-edit-section__title">Hours</h3>
                <div className="store-edit-grid store-edit-grid--days">
                  {DAY_LABELS.map(({ key, label }) => (
                    <label key={key} className="store-edit-field">
                      <span className="store-edit-label">{label}</span>
                      <input
                        value={editDraft[key]}
                        onChange={(e) => updateDraft({ [key]: e.target.value } as Partial<StoreEditDraft>)}
                        placeholder="e.g. 9:00–17:00"
                      />
                    </label>
                  ))}
                </div>
              </section>

              <section className="store-edit-section">
                <h3 className="store-edit-section__title">Description</h3>
                <label className="store-edit-field store-edit-field--full">
                  <span className="store-edit-label">Page description</span>
                  <textarea
                    rows={4}
                    value={editDraft.pageDescription}
                    onChange={(e) => updateDraft({ pageDescription: e.target.value })}
                  />
                </label>
              </section>

              <section className="store-edit-section store-edit-section--inline">
                <h3 className="store-edit-section__title">Premium</h3>
                <label className="store-edit-premium-toggle">
                  <div
                    className={`toggle-switch${editDraft.isPremium ? ' on' : ''}`}
                    onClick={() => updateDraft({ isPremium: !editDraft.isPremium })}
                    role="switch"
                    aria-checked={editDraft.isPremium}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === ' ' && updateDraft({ isPremium: !editDraft.isPremium })}
                  >
                    <div className="toggle-knob" />
                  </div>
                  <span>Premium store</span>
                </label>
              </section>
            </div>

            <div className="store-edit-modal__footer">
              <button type="button" className="store-edit-btn store-edit-btn--secondary" onClick={closeEditModal} disabled={editSaving}>
                Cancel
              </button>
              <button type="button" className="store-edit-btn store-edit-btn--primary" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

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
