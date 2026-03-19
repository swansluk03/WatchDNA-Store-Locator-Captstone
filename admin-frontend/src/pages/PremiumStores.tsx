import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import '../styles/PremiumStores.css';

interface PremiumStore {
  handle: string;
  addedAt: string;
  notes: string | null;
}

interface Location {
  id: string;
  handle: string;
  name: string;
  city: string | null;
  country: string | null;
  brands: string | null;
  isPremium: boolean;
}

const PremiumStores: React.FC = () => {
  const [stores, setStores] = useState<PremiumStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Add
  const [adding, setAdding] = useState(false);

  // Load premium stores list
  const loadStores = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get<{ stores: PremiumStore[] }>('/premium-stores');
      setStores(res.data.stores);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load premium stores');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  // Debounced search against /api/locations/search
  useEffect(() => {
    if (search.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/locations/search', {
          params: { q: search.trim(), limit: 20 },
        });
        const premiumHandles = new Set(stores.map((s) => s.handle));
        const results = (res.data.data || []).filter(
          (loc: Location) => !premiumHandles.has(loc.handle)
        );
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout.current);
  }, [search, stores]);

  const handleAddStore = async (storeHandle: string) => {
    setAdding(true);
    try {
      await api.post('/premium-stores', { handle: storeHandle });
      setSearch('');
      setSearchResults([]);
      await loadStores();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add premium store');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (storeHandle: string) => {
    if (!confirm(`Remove premium status from "${storeHandle}"?`)) return;
    try {
      await api.delete(`/premium-stores/${encodeURIComponent(storeHandle)}`);
      await loadStores();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove premium store');
    }
  };

  if (loading) {
    return <div className="loading">Loading premium stores...</div>;
  }

  return (
    <div className="premium-stores">
      <div className="page-header">
        <h1>Premium Stores</h1>
        <span className="stat-badge">{stores.length} premium retailers</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Search & add */}
      <div className="add-section">
        <h2>Add Premium Retailer</h2>
        <p className="add-description">
          Search for a store and click Add to give it premium status (gold pin on map).
        </p>
        <input
          type="text"
          placeholder="Search by store name or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />

        {searching && <div className="search-status">Searching...</div>}

        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((loc) => (
              <div key={loc.handle} className="search-result-item">
                <div className="result-info">
                  <span className="result-name">{loc.name}</span>
                  <span className="result-detail">
                    {[loc.city, loc.country].filter(Boolean).join(', ')}
                  </span>
                  {loc.brands && <span className="result-brands">{loc.brands}</span>}
                </div>
                <button
                  onClick={() => handleAddStore(loc.handle)}
                  disabled={adding}
                  className="button button-small button-primary"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        {search.trim().length >= 2 && !searching && searchResults.length === 0 && (
          <div className="no-results">No matching stores found</div>
        )}
      </div>

      {/* Current premium stores */}
      <div className="stores-section">
        <h2>Current Premium Retailers ({stores.length})</h2>

        {stores.length === 0 ? (
          <div className="empty-state">
            <p>No premium retailers yet. Search above to add stores.</p>
          </div>
        ) : (
          <table className="stores-table">
            <thead>
              <tr>
                <th>Handle</th>
                <th>Added</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.handle}>
                  <td className="handle-cell">{store.handle}</td>
                  <td className="date-cell">
                    {new Date(store.addedAt).toLocaleDateString()}
                  </td>
                  <td className="notes-cell">{store.notes || '-'}</td>
                  <td>
                    <button
                      onClick={() => handleRemove(store.handle)}
                      className="button button-small button-danger"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PremiumStores;
