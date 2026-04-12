import api from './api';

export interface StoreRecord {
  handle: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  country: string;
  postalCode: string | null;
  phone: string | null;
  brands: string | null;
  isPremium: boolean;
  website: string | null;
  imageUrl: string | null;
  pageDescription: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  storeType: string | null;
}

/** Body for PATCH /premium-stores/stores/:handle — all fields optional on wire; we send a full snapshot on save. */
export type StoreUpdatePayload = Partial<{
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvinceRegion: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  website: string | null;
  imageUrl: string | null;
  pageDescription: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  isPremium: boolean;
  storeType: string | null;
}>;

export async function fetchAllStores(): Promise<StoreRecord[]> {
  const res = await api.get<{ stores: StoreRecord[]; totalCount: number }>('/premium-stores/stores');
  return res.data.stores;
}

export async function updateStore(
  handle: string,
  payload: StoreUpdatePayload
): Promise<StoreRecord> {
  const encoded = encodeURIComponent(handle);
  const res = await api.patch<{ store: StoreRecord }>(`/premium-stores/stores/${encoded}`, payload);
  return res.data.store;
}

/** POST multipart field `image` — saves file and updates store imageUrl. */
export async function uploadStoreImage(handle: string, file: File): Promise<StoreRecord> {
  const formData = new FormData();
  formData.append('image', file);
  const encoded = encodeURIComponent(handle);
  const res = await api.post<{ store: StoreRecord }>(
    `/premium-stores/stores/${encoded}/image`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );
  return res.data.store;
}

export async function markStoresPremium(handles: string[]): Promise<{ marked: number }> {
  const res = await api.post<{ marked: number }>('/premium-stores/stores', { handles });
  return res.data;
}

export async function removeStoresPremium(handles: string[]): Promise<{ removed: number }> {
  const res = await api.delete<{ removed: number }>('/premium-stores/stores', { data: { handles } });
  return res.data;
}

/** Sync `Location.isPremium` with the `PremiumStore` registry (after bulk imports / drift). */
export async function reconcilePremiumFlags(): Promise<{
  setTrueCount: number;
  setFalseCount: number;
}> {
  const res = await api.post<{ setTrueCount: number; setFalseCount: number }>(
    '/premium-stores/reconcile'
  );
  return res.data;
}
