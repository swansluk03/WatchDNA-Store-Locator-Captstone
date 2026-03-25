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
}

export async function fetchAllStores(): Promise<StoreRecord[]> {
  const res = await api.get<{ stores: StoreRecord[]; totalCount: number }>('/premium/stores');
  return res.data.stores;
}

export async function markStoresPremium(handles: string[]): Promise<{ marked: number }> {
  const res = await api.post<{ marked: number }>('/premium/stores', { handles });
  return res.data;
}

export async function removeStoresPremium(handles: string[]): Promise<{ removed: number }> {
  const res = await api.delete<{ removed: number }>('/premium/stores', { data: { handles } });
  return res.data;
}
