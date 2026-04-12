import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { parseRowToLocationData } from '../utils/csv-to-location';
import { storeService } from './store.service';
import { normalizeCountry } from '../utils/country';

export interface LocationFilters {
  brand?: string;
  type?: string;
  country?: string;
  city?: string;
  status?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface NearbyParams {
  latitude: number;
  longitude: number;
  radius: number; // in miles
  filters?: LocationFilters;
}

export interface ImportResult {
  success: boolean;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
}

class LocationService {
  /**
   * Import locations from CSV file to database.
   * Delegates to storeService.batchUpsertLocations (resilient per-row mode) so
   * manual uploads share the same Location write logic as scraper jobs.
   *
   * @param uploadId When set (e.g. admin CSV upload), stamps Location.uploadId for reporting.
   */
  async importFromCSV(csvFilePath: string, uploadId?: string): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      newCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      errors: []
    };

    try {
      const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
      const parseResult = Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim()
      });

      const rows = parseResult.data as Record<string, string>[];
      logger.warn(`[LocationService] Importing ${rows.length} rows from CSV...`);

      for (const row of rows) {
        if (!parseRowToLocationData(row) && (row.Name || row.Handle)) {
          result.errors.push(`Invalid or missing required fields for: ${row.Name || row.Handle}`);
        }
      }

      const upsert = await storeService.batchUpsertLocations(rows, uploadId, {
        failFast: false,
        requireCompleteForDb: true,
      });

      result.newCount = upsert.created;
      result.updatedCount = upsert.updated + upsert.unchanged;
      result.skippedCount = upsert.skipped;
      result.errorCount = upsert.failed ?? 0;
      if (upsert.dbErrors && upsert.dbErrors.length > 0) {
        result.errors.push(...upsert.dbErrors);
      }

      result.success = true;
      logger.warn(
        `[LocationService] Import complete: ${result.newCount} new, ${result.updatedCount} updated, ` +
        `${result.skippedCount} skipped, ${result.errorCount} errors`
      );
    } catch (error: any) {
      result.success = false;
      result.errors.push(`Failed to read/parse CSV: ${error.message}`);
      logger.error('[LocationService] Import failed:', error);
    }

    return result;
  }

  /**
   * Get all locations with optional filtering and pagination.
   */
  async findAll(filters: LocationFilters = {}) {
    const {
      brand,
      type,
      country,
      city,
      status,
      search,
      limit = 100,
      offset = 0
    } = filters;

    const where: Prisma.LocationWhereInput = {};

    if (brand) {
      where.brands = { contains: brand, mode: 'insensitive' };
    }

    if (country) {
      where.country = normalizeCountry(country) || country;
    }

    if (city) {
      where.city = city;
    }

    if (status !== undefined) {
      where.status = status;
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [locations, total] = await Promise.all([
      prisma.location.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { name: 'asc' }
      }),
      prisma.location.count({ where })
    ]);

    return {
      data: locations,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
      hasMore: offset + limit < total
    };
  }

  /**
   * Find locations near a specific coordinate within a radius.
   */
  async findNearby(params: NearbyParams) {
    const { latitude, longitude, radius, filters = {} } = params;

    const { data: allLocations } = await this.findAll({
      ...filters,
      limit: 10000
    });

    const locationsWithDistance = allLocations.map(location => ({
      ...location,
      distance: this.calculateDistance(latitude, longitude, location.latitude, location.longitude)
    }));

    const nearbyLocations = locationsWithDistance
      .filter(loc => loc.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    return {
      data: nearbyLocations,
      total: nearbyLocations.length,
      centerLat: latitude,
      centerLng: longitude,
      radius
    };
  }

  /**
   * Find a single location by ID.
   */
  async findById(id: string) {
    return prisma.location.findUnique({ where: { id } });
  }

  /**
   * Search locations by name or address (case-insensitive on PostgreSQL).
   */
  async search(query: string, limit: number = 50) {
    const locations = await prisma.location.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { addressLine1: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } }
        ]
      },
      take: limit,
      orderBy: { name: 'asc' }
    });

    return { data: locations, total: locations.length, query };
  }

  /**
   * Get unique list of brands from all locations (both brands and customBrands columns).
   */
  async getBrands() {
    const locations = await prisma.location.findMany({
      select: { brands: true, customBrands: true },
      where: {
        OR: [
          { brands: { not: null } },
          { customBrands: { not: null } }
        ]
      }
    });

    const brandsSet = new Set<string>();

    for (const loc of locations) {
      // Plain-text comma-separated brands column
      if (loc.brands) {
        for (const b of loc.brands.split(',')) {
          const trimmed = b.trim();
          if (trimmed) brandsSet.add(trimmed);
        }
      }
      // HTML anchor-formatted customBrands column
      if (loc.customBrands) {
        const matches = loc.customBrands.match(/>([^<]+)<\/A>/gi);
        if (matches) {
          for (const m of matches) {
            const brand = m.replace(/^>|<\/A>$/gi, '').trim();
            if (brand) brandsSet.add(brand);
          }
        } else {
          // Fallback: plain comma-separated
          for (const b of loc.customBrands.split(',')) {
            const trimmed = b.trim();
            if (trimmed) brandsSet.add(trimmed);
          }
        }
      }
    }

    return Array.from(brandsSet).sort();
  }

  /**
   * Get statistics about locations.
   */
  async getStats() {
    const [total, activeCount, countries, cities, brands] = await Promise.all([
      prisma.location.count(),
      prisma.location.count({ where: { status: true } }),
      prisma.location.groupBy({ by: ['country'], _count: true }),
      prisma.location.groupBy({ by: ['city'], _count: true }),
      this.getBrands()
    ]);

    return {
      total,
      active: activeCount,
      inactive: total - activeCount,
      countries: countries.length,
      cities: cities.length,
      brands: brands.length,
      topCountries: countries
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(c => ({ country: c.country, count: c._count })),
      topCities: cities
        .sort((a, b) => b._count - a._count)
        .slice(0, 10)
        .map(c => ({ city: c.city, count: c._count }))
    };
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // miles
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

export default new LocationService();
