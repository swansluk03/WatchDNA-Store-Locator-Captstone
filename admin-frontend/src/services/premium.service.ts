import { isAxiosError } from 'axios';
import api from './api';

export type PremiumRetailKind = 'boutique' | 'multi_brand';

export type StoreListingType = 'Authorized Dealers' | 'AD Verified';

export type BrandFilterModeWire = 'brand' | 'verified_brand';

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
  storeType: StoreListingType;
  brandFilterMode: BrandFilterModeWire;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind | null;
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
  brands: string | null;
  monday: string | null;
  tuesday: string | null;
  wednesday: string | null;
  thursday: string | null;
  friday: string | null;
  saturday: string | null;
  sunday: string | null;
  isPremium: boolean;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind | null;
  brandFilterMode: BrandFilterModeWire | null;
}>;

export type MarkPremiumEntryPayload = {
  handle: string;
  isServiceCenter: boolean;
  premiumRetailKind: PremiumRetailKind;
};

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

export async function markStoresPremium(entries: MarkPremiumEntryPayload[]): Promise<{ marked: number }> {
  const res = await api.post<{ marked: number }>('/premium-stores/stores', { entries });
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

/** POST /uploads/manual-store — same validate_csv + import pipeline as CSV uploads. */
export type ManualStorePayload = {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  city: string;
  country: string;
  stateProvinceRegion?: string;
  postalCode?: string;
  phone?: string | null;
  email?: string;
  website?: string;
  latitude: number;
  longitude: number;
  brands?: string[] | string;
  pageTitle?: string;
  pageDescription?: string;
  status?: boolean;
  handle?: string;
};

export type ManualStoreValidationError = {
  row: number;
  field: string;
  issue: string;
  value?: string;
};

export type ManualStoreImportSummary = {
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
};

export type ManualStoreSubmitResult =
  | {
      success: true;
      uploadId: string;
      store: { handle: string; name: string } | null;
      importResult: ManualStoreImportSummary;
      warnings: unknown[];
    }
  | {
      success: false;
      error: string;
      message?: string;
      uploadId?: string;
      errors?: ManualStoreValidationError[];
      warnings?: unknown[];
      importResult?: ManualStoreImportSummary;
    };

export type GeocodeAddressPayload = {
  /** When set, used as the primary street / free-text line (combined with city, postal, region, country). */
  fullAddress?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  country?: string;
  stateProvinceRegion?: string;
  postalCode?: string;
};

export type GeocodeAddressResult =
  | { success: true; latitude: number; longitude: number }
  | { success: false; error: string; message?: string };

/** POST /uploads/geocode-address — forward-geocode using server-configured Photon/Nominatim. */
export async function geocodeAddressForManualStore(
  payload: GeocodeAddressPayload
): Promise<GeocodeAddressResult> {
  try {
    const res = await api.post<{ success: true; latitude: number; longitude: number }>(
      '/uploads/geocode-address',
      payload
    );
    if (res.data.success && typeof res.data.latitude === 'number' && typeof res.data.longitude === 'number') {
      return {
        success: true,
        latitude: res.data.latitude,
        longitude: res.data.longitude,
      };
    }
    return { success: false, error: 'invalid_response' };
  } catch (e: unknown) {
    if (isAxiosError(e) && e.response?.data && typeof e.response.data === 'object') {
      const d = e.response.data as Record<string, unknown>;
      if (d.success === false) {
        return {
          success: false,
          error: typeof d.error === 'string' ? d.error : 'request_failed',
          message: typeof d.message === 'string' ? d.message : undefined,
        };
      }
    }
    return {
      success: false,
      error: 'network_error',
      message: e instanceof Error ? e.message : 'Request failed',
    };
  }
}

export async function submitManualStore(payload: ManualStorePayload): Promise<ManualStoreSubmitResult> {
  try {
    const res = await api.post<{
      success: true;
      uploadId: string;
      store: { handle: string; name: string } | null;
      importResult: ManualStoreImportSummary;
      warnings: unknown[];
    }>('/uploads/manual-store', payload);
    return {
      success: true,
      uploadId: res.data.uploadId,
      store: res.data.store,
      importResult: res.data.importResult,
      warnings: res.data.warnings ?? [],
    };
  } catch (e: unknown) {
    if (isAxiosError(e) && e.response?.data && typeof e.response.data === 'object') {
      const d = e.response.data as Record<string, unknown>;
      if (d.success === false) {
        return {
          success: false,
          error: typeof d.error === 'string' ? d.error : 'request_failed',
          message: typeof d.message === 'string' ? d.message : undefined,
          uploadId: typeof d.uploadId === 'string' ? d.uploadId : undefined,
          errors: Array.isArray(d.errors) ? (d.errors as ManualStoreValidationError[]) : undefined,
          warnings: Array.isArray(d.warnings) ? d.warnings : undefined,
          importResult: d.importResult as ManualStoreImportSummary | undefined,
        };
      }
    }
    return {
      success: false,
      error: 'network_error',
      message: e instanceof Error ? e.message : 'Request failed',
    };
  }
}
